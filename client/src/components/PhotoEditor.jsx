import { useEffect, useMemo, useRef, useState } from "react";
import { deletePhoto, generateCaption, getPhoto, updatePhoto } from "../api";
import LocationAutocompleteInput from "./LocationAutocompleteInput";
import PeopleSelector from "./PeopleSelector";
import TagInput from "./TagInput";

function formatDateForInput(value) {
  if (!value) {
    return "";
  }

  return String(value).slice(0, 10);
}

function hasExifData(photo) {
  return Boolean(
    photo.camera_make
      || photo.camera_model
      || photo.focal_length
      || photo.iso
      || photo.shutter_speed
      || photo.aperture
  );
}

function buildPayload({
  title,
  description,
  altText,
  capturedAt,
  selectedPeopleIds,
  tagNames,
  neighborhood,
  city,
  region,
  country
}) {
  return {
    title,
    description,
    alt_text: altText,
    captured_at: capturedAt || null,
    people: selectedPeopleIds,
    tags: tagNames,
    neighborhood,
    city,
    region,
    country
  };
}

function addTagIfMissing(currentTags, nextTag) {
  if (currentTags.includes(nextTag)) {
    return currentTags;
  }

  return [...currentTags, nextTag];
}

function removeTagIfPresent(currentTags, targetTag) {
  return currentTags.filter((tag) => tag !== targetTag);
}

export default function PhotoEditor({
  photo,
  people,
  tags,
  locationOptions,
  onClose,
  onSaved,
  onDeleted,
  onNavigatePrevious,
  onNavigateNext
}) {
  const [title, setTitle] = useState(photo?.title || "");
  const [description, setDescription] = useState(photo?.description || "");
  const [aiCaption, setAiCaption] = useState(photo?.ai_caption || "");
  const [altText, setAltText] = useState(photo?.alt_text || "");
  const [capturedAt, setCapturedAt] = useState(formatDateForInput(photo?.captured_at));
  const [selectedPeopleIds, setSelectedPeopleIds] = useState((photo?.people || []).map((person) => person.id));
  const [tagNames, setTagNames] = useState(photo?.tags || []);
  const [catalogPeople, setCatalogPeople] = useState(people);
  const [neighborhood, setNeighborhood] = useState(photo?.neighborhood || "");
  const [city, setCity] = useState(photo?.city || "");
  const [region, setRegion] = useState(photo?.region || "");
  const [country, setCountry] = useState(photo?.country || "");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [error, setError] = useState("");
  const lastSavedPayloadRef = useRef("");
  const saveTimeoutRef = useRef(null);
  const savePromiseRef = useRef(null);

  useEffect(() => {
    setTitle(photo?.title || "");
    setDescription(photo?.description || "");
    setAiCaption(photo?.ai_caption || "");
    setAltText(photo?.alt_text || "");
    setCapturedAt(formatDateForInput(photo?.captured_at));
    setSelectedPeopleIds((photo?.people || []).map((person) => person.id));
    setTagNames(photo?.tags || []);
    setNeighborhood(photo?.neighborhood || "");
    setCity(photo?.city || "");
    setRegion(photo?.region || "");
    setCountry(photo?.country || "");
    setIsLightboxOpen(false);
    lastSavedPayloadRef.current = photo ? JSON.stringify(buildPayload({
      title: photo.title || "",
      description: photo.description || "",
      altText: photo.alt_text || "",
      capturedAt: formatDateForInput(photo.captured_at),
      selectedPeopleIds: (photo.people || []).map((person) => person.id),
      tagNames: photo.tags || [],
      neighborhood: photo.neighborhood || "",
      city: photo.city || "",
      region: photo.region || "",
      country: photo.country || ""
    })) : "";
    setSaveState("idle");
    setError("");
  }, [photo]);

  useEffect(() => {
    setCatalogPeople(people);
  }, [people]);

  const showExifSection = useMemo(() => (photo ? hasExifData(photo) : false), [photo]);
  const currentPayload = useMemo(() => buildPayload({
    title,
    description,
    altText,
    capturedAt,
    selectedPeopleIds,
    tagNames,
    neighborhood,
    city,
    region,
    country
  }), [title, description, altText, capturedAt, selectedPeopleIds, tagNames, neighborhood, city, region, country]);
  const serializedPayload = useMemo(() => JSON.stringify(currentPayload), [currentPayload]);

  async function persistChanges() {
    if (!photo) {
      return true;
    }

    if (serializedPayload === lastSavedPayloadRef.current) {
      return true;
    }

    if (savePromiseRef.current) {
      return savePromiseRef.current;
    }

    setIsSaving(true);
    setSaveState("saving");
    setError("");

    const savePromise = updatePhoto(photo.id, currentPayload)
      .then((response) => {
        lastSavedPayloadRef.current = serializedPayload;
        setSaveState("saved");
        onSaved(response.data);
        return true;
      })
      .catch((saveError) => {
        setError(saveError.message || "Failed to save photo");
        setSaveState("error");
        return false;
      })
      .finally(() => {
        setIsSaving(false);
        savePromiseRef.current = null;
      });

    savePromiseRef.current = savePromise;
    return savePromise;
  }

  useEffect(() => {
    if (!photo) {
      return;
    }

    if (serializedPayload === lastSavedPayloadRef.current) {
      return;
    }

    setSaveState("dirty");

    saveTimeoutRef.current = window.setTimeout(() => {
      persistChanges();
    }, 700);

    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [photo, serializedPayload]);

  useEffect(() => () => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!photo) {
      return;
    }

    async function handleKeyDown(event) {
      if (!event.metaKey) {
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      const target = event.target;

      if (
        target instanceof HTMLElement
        && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")
      ) {
        event.preventDefault();
      } else {
        event.preventDefault();
      }

      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      const didSave = await persistChanges();

      if (!didSave) {
        return;
      }

      if (event.key === "ArrowLeft") {
        onNavigatePrevious?.();
      } else {
        onNavigateNext?.();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [photo, onNavigateNext, onNavigatePrevious, serializedPayload, currentPayload]);

  async function handleDelete() {
    if (!window.confirm("Are you sure?")) {
      return;
    }

    setIsDeleting(true);
    setError("");

    try {
      await deletePhoto(photo.id);
      onDeleted(photo.id);
    } catch (deleteError) {
      setError(deleteError.message || "Failed to delete photo");
    } finally {
      setIsDeleting(false);
    }
  }

  function handlePersonCreated(person) {
    setCatalogPeople((currentPeople) => [...currentPeople, person].sort((a, b) => a.name.localeCompare(b.name)));
  }

  function handlePeopleChange(nextSelectedPeopleIds) {
    setSelectedPeopleIds(nextSelectedPeopleIds);

    if (nextSelectedPeopleIds.length > 0) {
      setTagNames((currentTags) => removeTagIfPresent(currentTags, "no-people"));
    }
  }

  function handleNoPeople() {
    setSelectedPeopleIds([]);
    setTagNames((currentTags) => addTagIfMissing(currentTags, "no-people"));
  }

  async function handleGenerateCaption() {
    if (!photo) {
      return;
    }

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const didSave = await persistChanges();

    if (!didSave) {
      return;
    }

    setIsGeneratingCaption(true);
    setError("");

    try {
      await generateCaption(photo.id);
      const refreshedPhotoResponse = await getPhoto(photo.id);
      const refreshedPhoto = refreshedPhotoResponse?.data;

      if (!refreshedPhoto) {
        throw new Error("Failed to refresh photo after caption generation");
      }

      setAiCaption(refreshedPhoto.ai_caption || "");
      setAltText(refreshedPhoto.alt_text || "");
      onSaved(refreshedPhoto);
    } catch (captionError) {
      setError(captionError.message || "Failed to generate AI caption");
    } finally {
      setIsGeneratingCaption(false);
    }
  }

  if (!photo) {
    return (
      <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-stone-300 bg-white">
        <div className="border-b border-stone-200 px-6 py-5">
          <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Photo Editor</p>
          <h2 className="mt-2 text-lg font-semibold text-stone-900">No photo selected</h2>
          <p className="mt-2 text-sm text-stone-500">Click a thumbnail to review metadata and make edits here.</p>
        </div>

        <div className="flex flex-1 items-center justify-center px-8 py-10">
          <div className="max-w-sm text-center">
            <p className="text-sm font-medium text-stone-700">The editor stays open now.</p>
            <p className="mt-2 text-sm leading-6 text-stone-500">
              Pick any photo from the grid and its image, metadata, people, tags, and location fields will appear in
              this column.
            </p>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-stone-300 bg-white">
      <div className="flex items-start justify-between border-b border-stone-200 px-6 py-5">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Photo Editor</p>
          <h2 className="mt-2 text-lg font-semibold text-stone-900">{photo.original_filename}</h2>
          <p className="mt-2 text-sm text-stone-500">
            {saveState === "saving" && "Saving changes..."}
            {saveState === "saved" && "Changes saved"}
            {saveState === "dirty" && "Waiting to save..."}
            {saveState === "error" && "Save failed"}
            {saveState === "idle" && "Ready"}
          </p>
        </div>

        <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm" aria-label="Clear editor">
          Clear
        </button>
      </div>

      <div className="border-b border-stone-200 px-6 py-5">
        <div className="overflow-hidden border border-stone-300 bg-stone-100">
          {photo.large_url ? (
            <button
              type="button"
              onClick={() => setIsLightboxOpen(true)}
              className="block w-full cursor-zoom-in"
              aria-label="Open larger photo preview"
            >
              <img
                src={photo.large_url}
                alt={photo.alt_text || photo.original_filename}
                className="max-h-[300px] w-full object-contain"
              />
            </button>
          ) : (
            <div className="flex h-[220px] items-center justify-center text-sm text-stone-500">No image available</div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-5">
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Title</span>
            <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} className="field" />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Notes for AI</span>
            <span className="mb-2 block text-sm text-stone-500">
              Private thoughts or context about the moment. This is for better caption generation, not public-facing copy.
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="field min-h-[120px] resize-y"
            />
          </label>

          <section className="border-t border-stone-200 pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-500">AI Caption</p>
                <p className="mt-2 text-sm text-stone-500">
                  Generate or regenerate this caption from the current photo metadata.
                </p>
              </div>
              <button
                type="button"
                onClick={handleGenerateCaption}
                disabled={isSaving || isDeleting || isGeneratingCaption}
                className="btn-secondary"
              >
                {isGeneratingCaption ? "Generating..." : aiCaption ? "Regenerate" : "Generate"}
              </button>
            </div>
            <div className="mt-4 border border-stone-300 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700">
              {aiCaption || "No AI caption generated yet."}
            </div>
          </section>

          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Alt Text</span>
            <input type="text" value={altText} onChange={(event) => setAltText(event.target.value)} className="field" />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Captured Date</span>
            <input
              type="date"
              value={capturedAt}
              onChange={(event) => setCapturedAt(event.target.value)}
              className="field"
            />
          </label>

          <section>
            <p className="mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">People</p>
            <PeopleSelector
              selectedIds={selectedPeopleIds}
              people={catalogPeople}
              onChange={handlePeopleChange}
              onPersonCreated={handlePersonCreated}
              onNoPeople={handleNoPeople}
            />
          </section>

          <section>
            <p className="mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">Tags</p>
            <TagInput tags={tagNames} allTags={tags} onChange={setTagNames} />
          </section>

          <section className="border-t border-stone-200 pt-5">
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Location</p>
            <div className="mt-4 grid gap-4">
              <LocationAutocompleteInput
                id="editor-neighborhood"
                label="Neighborhood"
                value={neighborhood}
                onChange={setNeighborhood}
                options={locationOptions?.neighborhoods || []}
              />
              <LocationAutocompleteInput
                id="editor-city"
                label="City"
                value={city}
                onChange={setCity}
                options={locationOptions?.cities || []}
              />
              <LocationAutocompleteInput
                id="editor-region"
                label="Region"
                value={region}
                onChange={setRegion}
                options={locationOptions?.regions || []}
              />
              <LocationAutocompleteInput
                id="editor-country"
                label="Country"
                value={country}
                onChange={setCountry}
                options={locationOptions?.countries || []}
              />
            </div>
          </section>

          {showExifSection ? (
            <section className="border-t border-stone-200 pt-5">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">EXIF</p>
              <dl className="mt-4 grid gap-3 text-sm text-stone-700">
                {photo.camera_make ? <ExifRow label="Camera Make" value={photo.camera_make} /> : null}
                {photo.camera_model ? <ExifRow label="Camera Model" value={photo.camera_model} /> : null}
                {photo.focal_length ? <ExifRow label="Focal Length" value={photo.focal_length} /> : null}
                {photo.iso ? <ExifRow label="ISO" value={photo.iso} /> : null}
                {photo.shutter_speed ? <ExifRow label="Shutter Speed" value={photo.shutter_speed} /> : null}
                {photo.aperture ? <ExifRow label="Aperture" value={photo.aperture} /> : null}
              </dl>
            </section>
          ) : null}

          <section className="border-t border-stone-200 pt-5">
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Status</p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <span className="rounded-full bg-white px-3 py-1.5 text-stone-700">
                Processing: {photo.processing_status}
              </span>
              <span className="rounded-full bg-white px-3 py-1.5 text-stone-700">Geo: {photo.geo_status}</span>
            </div>
          </section>

          {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        </div>
      </div>

      <div className="border-t border-stone-200 px-6 py-4">
        <div className="flex gap-3">
          <div className="flex flex-1 items-center rounded-2xl bg-stone-100 px-4 py-2.5 text-sm text-stone-600">
            Autosave is on
          </div>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isSaving || isDeleting}
            className="inline-flex flex-1 items-center justify-center rounded-2xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      {isLightboxOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 p-6"
          onClick={() => setIsLightboxOpen(false)}
        >
          <div
            className="relative max-h-full max-w-[min(92vw,1400px)]"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsLightboxOpen(false)}
            className="absolute right-4 top-4 z-10 rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-stone-900 shadow"
          >
            Close
          </button>
          <img
            src={photo.large_url}
            alt={photo.alt_text || photo.original_filename}
            className="max-h-[90vh] max-w-full border border-stone-300 bg-white object-contain shadow-2xl"
          />
        </div>
      </div>
      ) : null}
    </aside>
  );
}

function ExifRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-200 pb-2 last:border-b-0 last:pb-0">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right font-medium text-stone-800">{value}</dd>
    </div>
  );
}
