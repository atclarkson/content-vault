import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteVideo,
  generateVideoCaption,
  getVideo,
  refreshVideoStats,
  suggestVideoLocation,
  updateVideo
} from "../api";
import PeopleSelector from "./PeopleSelector";
import TagInput from "./TagInput";

const VIDEO_CATEGORIES = [
  { id: "travel", label: "Travel" },
  { id: "sponsored", label: "Sponsored" },
  { id: "review", label: "Review" },
  { id: "other", label: "Other" }
];

function formatDateForInput(value) {
  if (!value) {
    return "";
  }

  return String(value).slice(0, 10);
}

function formatCount(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function buildPayload({
  title,
  altText,
  notesForAi,
  dateFilmed,
  dateFilmedEnd,
  dateFilmedSource,
  filmedCity,
  filmedCountry,
  filmedLocationSource,
  selectedPeopleIds,
  tagNames
}) {
  return {
    title,
    alt_text: altText,
    notes_for_ai: notesForAi,
    date_filmed: dateFilmed || null,
    date_filmed_end: dateFilmedEnd || null,
    date_filmed_source: dateFilmedSource,
    filmed_city: filmedCity,
    filmed_country: filmedCountry,
    filmed_location_source: filmedLocationSource,
    people: selectedPeopleIds,
    tags: tagNames
  };
}

function getSourceLabel(value) {
  if (!value) {
    return "none";
  }

  return String(value).replace(/_/g, " ");
}

export default function VideoEditor({
  video,
  people,
  tags,
  tagGroups,
  onClose,
  onSaved,
  onDeleted
}) {
  const [title, setTitle] = useState(video?.title || "");
  const [altText, setAltText] = useState(video?.alt_text || "");
  const [aiCaption, setAiCaption] = useState(video?.ai_caption || "");
  const [notesForAi, setNotesForAi] = useState(video?.notes_for_ai || "");
  const [selectedPeopleIds, setSelectedPeopleIds] = useState((video?.people || []).map((person) => person.id));
  const [tagNames, setTagNames] = useState(video?.tags || []);
  const [catalogPeople, setCatalogPeople] = useState(people);
  const [dateFilmed, setDateFilmed] = useState(formatDateForInput(video?.date_filmed));
  const [dateFilmedEnd, setDateFilmedEnd] = useState(formatDateForInput(video?.date_filmed_end));
  const [dateFilmedSource, setDateFilmedSource] = useState(video?.date_filmed_source || "none");
  const [filmedCity, setFilmedCity] = useState(video?.filmed_city || "");
  const [filmedCountry, setFilmedCountry] = useState(video?.filmed_country || "");
  const [filmedLocationSource, setFilmedLocationSource] = useState(video?.filmed_location_source || "none");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefreshingStats, setIsRefreshingStats] = useState(false);
  const [isSuggestingLocation, setIsSuggestingLocation] = useState(false);
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [error, setError] = useState("");
  const [locationSuggestion, setLocationSuggestion] = useState(null);
  const lastSavedPayloadRef = useRef("");
  const saveTimeoutRef = useRef(null);
  const savePromiseRef = useRef(null);

  useEffect(() => {
    setTitle(video?.title || "");
    setAltText(video?.alt_text || "");
    setAiCaption(video?.ai_caption || "");
    setNotesForAi(video?.notes_for_ai || "");
    setSelectedPeopleIds((video?.people || []).map((person) => person.id));
    setTagNames(video?.tags || []);
    setDateFilmed(formatDateForInput(video?.date_filmed));
    setDateFilmedEnd(formatDateForInput(video?.date_filmed_end));
    setDateFilmedSource(video?.date_filmed_source || "none");
    setFilmedCity(video?.filmed_city || "");
    setFilmedCountry(video?.filmed_country || "");
    setFilmedLocationSource(video?.filmed_location_source || "none");
    setLocationSuggestion(null);
    setIsDescriptionExpanded(false);
    lastSavedPayloadRef.current = video ? JSON.stringify(buildPayload({
      title: video.title || "",
      altText: video.alt_text || "",
      notesForAi: video.notes_for_ai || "",
      dateFilmed: formatDateForInput(video.date_filmed),
      dateFilmedEnd: formatDateForInput(video.date_filmed_end),
      dateFilmedSource: video.date_filmed_source || "none",
      filmedCity: video.filmed_city || "",
      filmedCountry: video.filmed_country || "",
      filmedLocationSource: video.filmed_location_source || "none",
      selectedPeopleIds: (video.people || []).map((person) => person.id),
      tagNames: video.tags || []
    })) : "";
    setSaveState("idle");
    setError("");
  }, [video]);

  useEffect(() => {
    setCatalogPeople(people);
  }, [people]);

  const currentPayload = useMemo(() => buildPayload({
    title,
    altText,
    notesForAi,
    dateFilmed,
    dateFilmedEnd,
    dateFilmedSource,
    filmedCity,
    filmedCountry,
    filmedLocationSource,
    selectedPeopleIds,
    tagNames
  }), [
    title,
    altText,
    notesForAi,
    dateFilmed,
    dateFilmedEnd,
    dateFilmedSource,
    filmedCity,
    filmedCountry,
    filmedLocationSource,
    selectedPeopleIds,
    tagNames
  ]);
  const serializedPayload = useMemo(() => JSON.stringify(currentPayload), [currentPayload]);

  async function persistChanges() {
    if (!video) {
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

    const savePromise = updateVideo(video.id, currentPayload)
      .then((response) => {
        lastSavedPayloadRef.current = serializedPayload;
        setSaveState("saved");
        onSaved(response.data);
        return true;
      })
      .catch((saveError) => {
        setError(saveError.message || "Failed to save video");
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
    if (!video) {
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
  }, [video, serializedPayload]);

  useEffect(() => () => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
  }, []);

  async function refreshVideoRecord() {
    const response = await getVideo(video.id);
    const refreshedVideo = response?.data;

    if (!refreshedVideo) {
      throw new Error("Failed to refresh video");
    }

    onSaved(refreshedVideo);
    return refreshedVideo;
  }

  async function handleRefreshStats() {
    if (!video) {
      return;
    }

    setIsRefreshingStats(true);
    setError("");

    try {
      await refreshVideoStats();
      await refreshVideoRecord();
    } catch (refreshError) {
      setError(refreshError.message || "Failed to refresh video stats");
    } finally {
      setIsRefreshingStats(false);
    }
  }

  async function handleToggleVideoType() {
    if (!video) {
      return;
    }

    setError("");

    try {
      const response = await updateVideo(video.id, {
        video_type: video.video_type === "short" ? "longform" : "short",
        video_type_manually_set: 1
      });
      onSaved(response.data);
    } catch (updateError) {
      setError(updateError.message || "Failed to update video type");
    }
  }

  async function handleCategoryChange(nextCategory) {
    if (!video) {
      return;
    }

    setError("");

    try {
      const response = await updateVideo(video.id, {
        video_category: nextCategory
      });
      onSaved(response.data);
    } catch (updateError) {
      setError(updateError.message || "Failed to update category");
    }
  }

  async function handleSuggestLocation() {
    if (!video) {
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

    setIsSuggestingLocation(true);
    setError("");
    setLocationSuggestion(null);

    try {
      const response = await suggestVideoLocation(video.id);
      setLocationSuggestion(response?.data || null);
    } catch (suggestionError) {
      setError(suggestionError.message || "Failed to get location suggestion");
    } finally {
      setIsSuggestingLocation(false);
    }
  }

  async function handleConfirmSuggestion() {
    if (!video || !locationSuggestion) {
      return;
    }

    setError("");

    try {
      const response = await updateVideo(video.id, {
        filmed_city: locationSuggestion.filmed_city || null,
        filmed_country: locationSuggestion.filmed_country || null,
        filmed_location_source: "confirmed",
        date_filmed: locationSuggestion.date_filmed || null,
        date_filmed_end: locationSuggestion.date_filmed_end || null,
        date_filmed_source: "confirmed"
      });
      setLocationSuggestion(null);
      onSaved(response.data);
    } catch (confirmError) {
      setError(confirmError.message || "Failed to apply suggestion");
    }
  }

  async function handleDelete() {
    if (!video || !window.confirm("Are you sure?")) {
      return;
    }

    setIsDeleting(true);
    setError("");

    try {
      await deleteVideo(video.id);
      onDeleted(video.id);
    } catch (deleteError) {
      setError(deleteError.message || "Failed to delete video");
    } finally {
      setIsDeleting(false);
    }
  }

  function handlePersonCreated(person) {
    setCatalogPeople((currentPeople) => [...currentPeople, person].sort((a, b) => a.name.localeCompare(b.name)));
  }

  function handleManualDateChange(field, value) {
    if (field === "start") {
      setDateFilmed(value);
    } else {
      setDateFilmedEnd(value);
    }

    setDateFilmedSource("manual");
  }

  function handleManualLocationChange(field, value) {
    if (field === "city") {
      setFilmedCity(value);
    } else {
      setFilmedCountry(value);
    }

    setFilmedLocationSource("manual");
  }

  async function handleGenerateCaption() {
    if (!video) {
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
      await generateVideoCaption(video.id);
      const refreshedVideo = await refreshVideoRecord();
      setAiCaption(refreshedVideo.ai_caption || "");
      setAltText(refreshedVideo.alt_text || "");
    } catch (captionError) {
      setError(captionError.message || "Failed to generate video caption");
    } finally {
      setIsGeneratingCaption(false);
    }
  }

  if (!video) {
    return (
      <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-stone-300 bg-white">
        <div className="border-b border-stone-200 px-6 py-5">
          <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Video Editor</p>
          <h2 className="mt-2 text-lg font-semibold text-stone-900">No video selected</h2>
          <p className="mt-2 text-sm text-stone-500">Select a video to review metadata and make edits here.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-stone-300 bg-white">
      <div className="border-b border-stone-200 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Video Editor</p>
            <p className="mt-2 text-sm text-stone-500">
              {saveState === "saving" && "Saving changes..."}
              {saveState === "saved" && "Changes saved"}
              {saveState === "dirty" && "Waiting to save..."}
              {saveState === "error" && "Save failed"}
              {saveState === "idle" && "Ready"}
            </p>
          </div>

          <button type="button" onClick={onClose} className="btn-secondary px-4 py-2 text-sm" aria-label="Close editor">
            Close
          </button>
        </div>

        <div className="mt-5 overflow-hidden border border-stone-300 bg-stone-100">
          {video.thumbnail_url ? (
            <img
              src={video.thumbnail_url}
              alt={video.title || "Video thumbnail"}
              className="h-auto w-full object-cover"
            />
          ) : (
            <div className="flex h-[220px] items-center justify-center text-sm text-stone-500">No thumbnail available</div>
          )}
        </div>

        <h2 className="mt-4 text-lg font-semibold text-stone-900">{video.title || "Untitled video"}</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="space-y-5">
          <section className="border-b border-stone-200 pb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-3 text-sm text-stone-700">
                <span className="rounded-full bg-stone-100 px-3 py-1.5">Views: {formatCount(video.view_count)}</span>
                <span className="rounded-full bg-stone-100 px-3 py-1.5">Likes: {formatCount(video.like_count)}</span>
                <span className="rounded-full bg-stone-100 px-3 py-1.5">Comments: {formatCount(video.comment_count)}</span>
              </div>

              <button
                type="button"
                onClick={handleRefreshStats}
                disabled={isRefreshingStats}
                className="btn-secondary"
              >
                {isRefreshingStats ? "Refreshing..." : "Refresh Stats"}
              </button>
            </div>
          </section>

          <section className="border-b border-stone-200 pb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700">
                  {video.video_type === "short" ? "Short" : "Longform"}
                </span>
                <span className="text-sm text-stone-500">
                  {video.video_type_manually_set ? "manually set" : "auto-classified"}
                </span>
              </div>

              <button type="button" onClick={handleToggleVideoType} className="btn-secondary">
                Flip Type
              </button>
            </div>
          </section>

          <section className="border-b border-stone-200 pb-5">
            <p className="mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">Category</p>
            <div className="flex flex-wrap gap-2">
              {VIDEO_CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => handleCategoryChange(category.id)}
                  className={video.video_category === category.id ? "btn-primary" : "btn-secondary"}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </section>

          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Title Override</span>
            <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} className="field" />
          </label>

          <section className="border-t border-stone-200 pt-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Filmed Dates</p>
              <span className="text-sm text-stone-500">Source: {getSourceLabel(dateFilmedSource)}</span>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm text-stone-600">Start</span>
                <input
                  type="date"
                  value={dateFilmed}
                  onChange={(event) => handleManualDateChange("start", event.target.value)}
                  className="field"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-stone-600">End</span>
                <input
                  type="date"
                  value={dateFilmedEnd}
                  onChange={(event) => handleManualDateChange("end", event.target.value)}
                  className="field"
                />
              </label>
            </div>
          </section>

          <section className="border-t border-stone-200 pt-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Filmed Location</p>
              <span className="text-sm text-stone-500">Source: {getSourceLabel(filmedLocationSource)}</span>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm text-stone-600">City</span>
                <input
                  type="text"
                  value={filmedCity}
                  onChange={(event) => handleManualLocationChange("city", event.target.value)}
                  className="field"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-stone-600">Country</span>
                <input
                  type="text"
                  value={filmedCountry}
                  onChange={(event) => handleManualLocationChange("country", event.target.value)}
                  className="field"
                />
              </label>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={handleSuggestLocation}
                disabled={isSuggestingLocation}
                className="btn-secondary"
              >
                {isSuggestingLocation ? "Asking AI..." : "Ask AI"}
              </button>
            </div>

            {locationSuggestion ? (
              <div className="mt-4 border border-stone-300 bg-stone-50 px-4 py-4 text-sm text-stone-700">
                <p><span className="font-medium">City:</span> {locationSuggestion.filmed_city || "Unknown"}</p>
                <p className="mt-1"><span className="font-medium">Country:</span> {locationSuggestion.filmed_country || "Unknown"}</p>
                <p className="mt-1">
                  <span className="font-medium">Date Range:</span> {locationSuggestion.date_filmed || "Unknown"}
                  {locationSuggestion.date_filmed_end ? ` to ${locationSuggestion.date_filmed_end}` : ""}
                </p>
                <p className="mt-1"><span className="font-medium">Confidence:</span> {locationSuggestion.confidence || "Unknown"}</p>
                <p className="mt-3 leading-6 text-stone-600">{locationSuggestion.reasoning || ""}</p>
                <div className="mt-4 flex gap-3">
                  <button type="button" onClick={handleConfirmSuggestion} className="btn-primary">
                    Confirm
                  </button>
                  <button type="button" onClick={() => setLocationSuggestion(null)} className="btn-secondary">
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}
          </section>

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
            <TagInput tags={tagNames} allTags={tags} tagGroups={tagGroups} onChange={setTagNames} />
          </section>

          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Notes for AI</span>
            <span className="mb-2 block text-sm text-stone-500">
              Private context for caption generation, not public-facing copy.
            </span>
            <textarea
              value={notesForAi}
              onChange={(event) => setNotesForAi(event.target.value)}
              className="field min-h-[120px] resize-y"
            />
          </label>

          <section className="border-t border-stone-200 pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-500">AI Caption</p>
                <p className="mt-2 text-sm text-stone-500">
                  Generate or regenerate this caption from the current video metadata.
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

          <section className="border-t border-stone-200 pt-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Description</p>
              {video.description ? (
                <button
                  type="button"
                  onClick={() => setIsDescriptionExpanded((currentValue) => !currentValue)}
                  className="btn-secondary px-4 py-2 text-sm"
                >
                  {isDescriptionExpanded ? "Collapse" : "Expand"}
                </button>
              ) : null}
            </div>
            <div className={`mt-4 border border-stone-300 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700 ${
              isDescriptionExpanded ? "" : "max-h-[180px] overflow-hidden"
            }`}>
              {video.description || "No YouTube description available."}
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
