import { useEffect, useMemo, useRef, useState } from "react";
import { deletePhoto, updatePhoto } from "../api";
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

export default function PhotoEditor({ photo, people, tags, onClose, onSaved, onDeleted }) {
  const [title, setTitle] = useState(photo.title || "");
  const [description, setDescription] = useState(photo.description || "");
  const [altText, setAltText] = useState(photo.alt_text || "");
  const [capturedAt, setCapturedAt] = useState(formatDateForInput(photo.captured_at));
  const [selectedPeopleIds, setSelectedPeopleIds] = useState((photo.people || []).map((person) => person.id));
  const [tagNames, setTagNames] = useState(photo.tags || []);
  const [catalogPeople, setCatalogPeople] = useState(people);
  const [neighborhood, setNeighborhood] = useState(photo.neighborhood || "");
  const [city, setCity] = useState(photo.city || "");
  const [region, setRegion] = useState(photo.region || "");
  const [country, setCountry] = useState(photo.country || "");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [error, setError] = useState("");
  const lastSavedPayloadRef = useRef("");

  useEffect(() => {
    setTitle(photo.title || "");
    setDescription(photo.description || "");
    setAltText(photo.alt_text || "");
    setCapturedAt(formatDateForInput(photo.captured_at));
    setSelectedPeopleIds((photo.people || []).map((person) => person.id));
    setTagNames(photo.tags || []);
    setNeighborhood(photo.neighborhood || "");
    setCity(photo.city || "");
    setRegion(photo.region || "");
    setCountry(photo.country || "");
    lastSavedPayloadRef.current = JSON.stringify(buildPayload({
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
    }));
    setSaveState("idle");
    setError("");
  }, [photo]);

  useEffect(() => {
    setCatalogPeople(people);
  }, [people]);

  const showExifSection = useMemo(() => hasExifData(photo), [photo]);
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

  useEffect(() => {
    if (serializedPayload === lastSavedPayloadRef.current) {
      return;
    }

    setSaveState("dirty");

    const timeoutId = window.setTimeout(async () => {
      setIsSaving(true);
      setSaveState("saving");
      setError("");

      try {
        const response = await updatePhoto(photo.id, currentPayload);
        lastSavedPayloadRef.current = serializedPayload;
        setSaveState("saved");
        onSaved(response.data);
      } catch (saveError) {
        setError(saveError.message || "Failed to save photo");
        setSaveState("error");
      } finally {
        setIsSaving(false);
      }
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [photo.id, currentPayload, onSaved, serializedPayload]);

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

  return (
    <aside className="fixed right-0 top-0 z-40 flex h-screen w-[560px] max-w-full flex-col border-l border-stone-300 bg-white shadow-panel">
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

        <button type="button" onClick={onClose} className="btn-secondary px-3 py-2" aria-label="Close editor">
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="overflow-hidden rounded-[2rem] border border-stone-300 bg-stone-100">
          {photo.large_url ? (
            <img src={photo.large_url} alt={photo.alt_text || photo.original_filename} className="w-full object-contain" />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center text-sm text-stone-500">No image available</div>
          )}
        </div>

        <div className="mt-6 space-y-5">
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Title</span>
            <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} className="field" />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="field min-h-[120px] resize-y"
            />
          </label>

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
              onChange={setSelectedPeopleIds}
              onPersonCreated={handlePersonCreated}
            />
          </section>

          <section>
            <p className="mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">Tags</p>
            <TagInput tags={tagNames} allTags={tags} onChange={setTagNames} />
          </section>

          <section className="rounded-[1.75rem] border border-stone-300 bg-stone-50 p-4">
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Location</p>
            <div className="mt-4 grid gap-4">
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-stone-500">Neighborhood</span>
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(event) => setNeighborhood(event.target.value)}
                  className="field"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-stone-500">City</span>
                <input type="text" value={city} onChange={(event) => setCity(event.target.value)} className="field" />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-stone-500">Region</span>
                <input type="text" value={region} onChange={(event) => setRegion(event.target.value)} className="field" />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-stone-500">Country</span>
                <input type="text" value={country} onChange={(event) => setCountry(event.target.value)} className="field" />
              </label>
            </div>
          </section>

          {showExifSection ? (
            <section className="rounded-[1.75rem] border border-stone-300 bg-stone-50 p-4">
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

          <section className="rounded-[1.75rem] border border-stone-300 bg-stone-50 p-4">
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
