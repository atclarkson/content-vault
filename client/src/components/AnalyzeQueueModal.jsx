import { useEffect, useMemo, useRef, useState } from "react";
import { generateCaption, updatePhoto } from "../api";
import PeopleSelector from "./PeopleSelector";

function normalizeTagKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getGroupColorClass(color) {
  return String(color || "").trim() || "bg-stone-400";
}

function mergeTags(existingTags, suggestedTags) {
  const merged = [...existingTags];
  const seen = new Set(existingTags.map((tag) => normalizeTagKey(tag)));

  for (const tag of suggestedTags) {
    const nextTag = tag.name || tag;
    const normalizedKey = normalizeTagKey(nextTag);

    if (!normalizedKey || seen.has(normalizedKey)) {
      continue;
    }

    merged.push(nextTag);
    seen.add(normalizedKey);
  }

  return merged;
}

function buildSuggestionState(suggestions, photo, knownTags, tagGroups) {
  const tagByKey = new Map(
    (knownTags || []).map((tag) => [normalizeTagKey(tag.name), tag]),
  );
  const groupByName = new Map(
    (tagGroups || []).map((group) => [normalizeTagKey(group.name), group]),
  );
  const mergedTags = mergeTags(photo.tags || [], suggestions.tags || []);

  return {
    people: suggestions.people || [],
    title: suggestions.title || "",
    aiCaption: suggestions.aiCaption || "",
    altText: suggestions.altText || "",
    tags: mergedTags,
    tagRecords: (suggestions.tags || []).map((tag) => {
      const tagName = tag.name || tag;
      const existingTag = tagByKey.get(normalizeTagKey(tagName));
      const matchingGroup = groupByName.get(
        normalizeTagKey(tag.group_name || ""),
      );

      return {
        name: existingTag?.name || tagName,
        groupColor: existingTag?.group_color || matchingGroup?.color || null,
      };
    }),
  };
}

function buildDefaultFieldSelection(suggestionState, notesChanged) {
  return {
    notes: notesChanged,
    people: suggestionState.people.length > 0,
    title: Boolean(suggestionState.title),
    aiCaption: Boolean(suggestionState.aiCaption),
    altText: Boolean(suggestionState.altText),
    tags: suggestionState.tagRecords.length > 0,
  };
}

function buildAnalyzeErrorMessage(error) {
  return error?.message || "Failed to analyze photo";
}

function formatLogTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatCapturedDateTime(value) {
  if (!value) {
    return "Unknown date";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Unknown date";
  }

  const hasTime = String(value).includes("T");

  return new Intl.DateTimeFormat(
    "en-US",
    hasTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" },
  ).format(parsed);
}

function formatPhotoLocation(photo) {
  const parts = [
    photo?.neighborhood,
    photo?.city,
    photo?.region,
    photo?.country,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "Unknown location";
}

function sortNumericIds(values) {
  return [...values].sort((left, right) => left - right);
}

function areIdListsEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

export default function AnalyzeQueueModal({
  isOpen,
  photos,
  people,
  tags,
  tagGroups,
  onClose,
  onPhotoUpdated,
}) {
  const [queue, setQueue] = useState([]);
  const [notesForAi, setNotesForAi] = useState("");
  const [fieldSelection, setFieldSelection] = useState({
    notes: false,
    people: false,
    title: false,
    aiCaption: false,
    altText: false,
    tags: false,
  });
  const [selectedPeopleIds, setSelectedPeopleIds] = useState([]);
  const [analysisByPhotoId, setAnalysisByPhotoId] = useState({});
  const [isApplying, setIsApplying] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [error, setError] = useState("");
  const [activityLog, setActivityLog] = useState([]);
  const [history, setHistory] = useState([]);
  const analysisByPhotoIdRef = useRef({});
  const wasOpenRef = useRef(false);

  useEffect(() => {
    analysisByPhotoIdRef.current = analysisByPhotoId;
  }, [analysisByPhotoId]);

  function logQueueEvent(message, details = {}) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: formatLogTime(),
      message,
    };

    setActivityLog((currentValue) => [entry, ...currentValue].slice(0, 10));
    console.info("[AnalyzeQueue]", message, details);
  }

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    if (wasOpenRef.current) {
      return;
    }

    wasOpenRef.current = true;
    setQueue(photos);
    setAnalysisByPhotoId({});
    setError("");
    setActivityLog([]);
    setHistory([]);
    console.info("[AnalyzeQueue] opened", {
      queueLength: photos.length,
      photoIds: photos.map((photo) => photo.id),
    });
  }, [isOpen, photos]);

  const currentPhoto = queue[0] || null;
  const nextPhoto = queue[1] || null;
  const prefetchedPhotos = queue.slice(1, 3);
  const currentAnalysis = currentPhoto
    ? analysisByPhotoId[currentPhoto.id] || null
    : null;
  const currentNotesMatchSavedValue =
    (currentPhoto?.notes_for_ai || "") === notesForAi;
  const selectedPeopleIdsSignature = useMemo(
    () => sortNumericIds(selectedPeopleIds),
    [selectedPeopleIds],
  );
  const currentAnalysisIsFresh =
    currentAnalysis?.notesForAiUsed === notesForAi &&
    areIdListsEqual(
      currentAnalysis?.peopleIdsUsed || [],
      selectedPeopleIdsSignature,
    );

  const currentSuggestionState = useMemo(() => {
    if (!currentPhoto || !currentAnalysis?.suggestions) {
      return null;
    }

    return buildSuggestionState(
      currentAnalysis.suggestions,
      currentPhoto,
      tags,
      tagGroups,
    );
  }, [currentAnalysis?.suggestions, currentPhoto, tagGroups, tags]);

  useEffect(() => {
    if (!currentPhoto) {
      setNotesForAi("");
      setFieldSelection({
        notes: false,
        people: false,
        title: false,
        aiCaption: false,
        altText: false,
        tags: false,
      });
      setSelectedPeopleIds([]);
      return;
    }

    const nextNotes = currentPhoto.notes_for_ai || "";
    setNotesForAi(nextNotes);
    setSelectedPeopleIds(
      (currentPhoto.people || []).map((person) => person.id),
    );
    setFieldSelection((currentValue) => {
      if (currentAnalysis?.suggestions) {
        return buildDefaultFieldSelection(
          buildSuggestionState(
            currentAnalysis.suggestions,
            currentPhoto,
            tags,
            tagGroups,
          ),
          false,
        );
      }

      return {
        title: false,
        aiCaption: false,
        altText: false,
        tags: false,
        people: false,
        notes: false,
      };
    });
  }, [currentPhoto?.id]);

  useEffect(() => {
    if (!currentPhoto) {
      return;
    }

    setFieldSelection((currentValue) => ({
      ...currentValue,
      notes: (currentPhoto.notes_for_ai || "") !== notesForAi,
    }));
  }, [currentPhoto?.id, currentPhoto?.notes_for_ai, notesForAi]);

  useEffect(() => {
    if (!currentPhoto || !currentSuggestionState || !currentAnalysisIsFresh) {
      return;
    }

    setFieldSelection(
      buildDefaultFieldSelection(
        currentSuggestionState,
        (currentPhoto.notes_for_ai || "") !== notesForAi,
      ),
    );
  }, [
    currentAnalysis?.notesForAiUsed,
    currentPhoto?.id,
    currentPhoto?.notes_for_ai,
    currentAnalysisIsFresh,
    currentSuggestionState,
    notesForAi,
  ]);

  useEffect(() => {
    if (!isOpen || !currentPhoto) {
      return;
    }

    void analyzePhoto(currentPhoto, currentPhoto.notes_for_ai || "", {
      force: false,
      markCurrent: false,
      reason: "current-photo",
      peopleIds: sortNumericIds(
        (currentPhoto.people || []).map((person) => person.id),
      ),
    });
  }, [isOpen, currentPhoto?.id]);

  useEffect(() => {
    if (!isOpen || prefetchedPhotos.length === 0) {
      return;
    }

    for (const [index, photo] of prefetchedPhotos.entries()) {
      void analyzePhoto(photo, photo.notes_for_ai || "", {
        force: false,
        markCurrent: false,
        reason: `prefetch-buffer-${index + 1}`,
        peopleIds: sortNumericIds(
          (photo.people || []).map((person) => person.id),
        ),
      });
    }
  }, [isOpen, queue]);

  async function analyzePhoto(
    photo,
    notesValue,
    { force, markCurrent, reason, peopleIds },
  ) {
    const existingAnalysis = analysisByPhotoIdRef.current[photo.id];
    const normalizedPeopleIds = sortNumericIds(peopleIds || []);

    if (
      !force &&
      existingAnalysis?.status === "done" &&
      existingAnalysis.notesForAiUsed === notesValue &&
      areIdListsEqual(existingAnalysis.peopleIdsUsed || [], normalizedPeopleIds)
    ) {
      logQueueEvent(
        `Skipped analysis for ${photo.original_filename}, already ready`,
        {
          photoId: photo.id,
          reason,
        },
      );
      return existingAnalysis;
    }

    if (
      !force &&
      existingAnalysis?.status === "loading" &&
      existingAnalysis.notesForAiUsed === notesValue &&
      areIdListsEqual(existingAnalysis.peopleIdsUsed || [], normalizedPeopleIds)
    ) {
      logQueueEvent(
        `Skipped analysis for ${photo.original_filename}, request already running`,
        {
          photoId: photo.id,
          reason,
        },
      );
      return existingAnalysis;
    }

    logQueueEvent(`Starting analysis for ${photo.original_filename}`, {
      photoId: photo.id,
      reason,
      hasNotes: Boolean(String(notesValue || "").trim()),
    });

    setAnalysisByPhotoId((currentValue) => ({
      ...currentValue,
      [photo.id]: {
        status: "loading",
        suggestions: existingAnalysis?.suggestions || null,
        notesForAiUsed: notesValue,
        peopleIdsUsed: normalizedPeopleIds,
        error: "",
      },
    }));

    if (markCurrent) {
      setIsReanalyzing(true);
      setError("");
    }

    try {
      const response = await generateCaption(photo.id, {
        notes_for_ai: notesValue,
        people: normalizedPeopleIds,
      });
      const nextSuggestions = {
        people: response?.data?.suggested_people || [],
        title: response?.data?.suggested_title || "",
        aiCaption: response?.data?.ai_caption || "",
        altText: response?.data?.alt_text || "",
        tags: response?.data?.suggested_tags || [],
      };

      setAnalysisByPhotoId((currentValue) => {
        const currentAnalysisEntry = currentValue[photo.id];

        if (currentAnalysisEntry?.notesForAiUsed !== notesValue) {
          return currentValue;
        }

        return {
          ...currentValue,
          [photo.id]: {
            status: "done",
            suggestions: nextSuggestions,
            notesForAiUsed: response?.data?.notes_for_ai_used ?? notesValue,
            peopleIdsUsed: sortNumericIds(
              response?.data?.people_used || normalizedPeopleIds,
            ),
            error: "",
          },
        };
      });

      logQueueEvent(`Finished analysis for ${photo.original_filename}`, {
        photoId: photo.id,
        reason,
        suggestedTags: nextSuggestions.tags.length,
      });

      return nextSuggestions;
    } catch (analyzeError) {
      setAnalysisByPhotoId((currentValue) => ({
        ...currentValue,
        [photo.id]: {
          status: "error",
          suggestions: null,
          notesForAiUsed: notesValue,
          peopleIdsUsed: normalizedPeopleIds,
          error: buildAnalyzeErrorMessage(analyzeError),
        },
      }));

      if (markCurrent) {
        setError(buildAnalyzeErrorMessage(analyzeError));
      }

      logQueueEvent(`Analysis failed for ${photo.original_filename}`, {
        photoId: photo.id,
        reason,
        error: buildAnalyzeErrorMessage(analyzeError),
      });

      return null;
    } finally {
      if (markCurrent) {
        setIsReanalyzing(false);
      }
    }
  }

  function toggleField(field) {
    setFieldSelection((currentValue) => ({
      ...currentValue,
      [field]: !currentValue[field],
    }));
  }

  async function handleReanalyze() {
    if (!currentPhoto) {
      return;
    }

    await analyzePhoto(currentPhoto, notesForAi, {
      force: true,
      markCurrent: true,
      reason: "manual-reanalyze",
      peopleIds: selectedPeopleIdsSignature,
    });
  }

  async function handleApplyAndAdvance() {
    if (!currentPhoto || !currentSuggestionState) {
      return;
    }

    setIsApplying(true);
    setError("");

    try {
      const payload = {};

      if (fieldSelection.notes) {
        payload.notes_for_ai = notesForAi;
      }

      if (fieldSelection.people) {
        payload.people = selectedPeopleIds;
      }

      if (fieldSelection.title && currentSuggestionState.title) {
        payload.title = currentSuggestionState.title;
      }

      if (fieldSelection.aiCaption && currentSuggestionState.aiCaption) {
        payload.ai_caption = currentSuggestionState.aiCaption;
      }

      if (fieldSelection.altText && currentSuggestionState.altText) {
        payload.alt_text = currentSuggestionState.altText;
      }

      if (fieldSelection.tags) {
        payload.tags = currentSuggestionState.tags;
      }

      const didChangeAnything = Object.keys(payload).length > 0;
      let updatedPhoto = currentPhoto;

      if (didChangeAnything) {
        const response = await updatePhoto(currentPhoto.id, payload);
        updatedPhoto = response?.data || currentPhoto;
        onPhotoUpdated(updatedPhoto);
      }

      setHistory((currentValue) =>
        [
          {
            photo: updatedPhoto,
            action: "apply",
          },
          ...currentValue,
        ].slice(0, 25),
      );

      setQueue((currentValue) => {
        const nextQueue = currentValue.filter(
          (photo) => photo.id !== currentPhoto.id,
        );

        if (nextQueue.length === 0) {
          window.setTimeout(() => {
            onClose();
          }, 0);
        }

        return nextQueue;
      });

      logQueueEvent(`Applied fields for ${currentPhoto.original_filename}`, {
        photoId: currentPhoto.id,
        appliedFields: Object.keys(payload),
      });

      setAnalysisByPhotoId((currentValue) => {
        const nextValue = { ...currentValue };
        delete nextValue[currentPhoto.id];
        return nextValue;
      });
    } catch (applyError) {
      setError(applyError.message || "Failed to apply analysis");
    } finally {
      setIsApplying(false);
    }
  }

  function handleSkip() {
    if (queue.length <= 1) {
      onClose();
      return;
    }

    setQueue((currentValue) => {
      if (currentValue.length <= 1) {
        return currentValue;
      }

      return [...currentValue.slice(1), currentValue[0]];
    });
    setHistory((currentValue) =>
      [
        {
          photo: currentPhoto,
          action: "skip",
        },
        ...currentValue,
      ].slice(0, 25),
    );
    logQueueEvent(`Skipped ${currentPhoto.original_filename}`, {
      photoId: currentPhoto.id,
    });
    setError("");
  }

  function handleBack() {
    const previousEntry = history[0];

    if (!previousEntry) {
      return;
    }

    setHistory((currentValue) => currentValue.slice(1));
    setQueue((currentValue) => {
      const remainingQueue = currentValue.filter(
        (photo) => photo.id !== previousEntry.photo.id,
      );
      return [previousEntry.photo, ...remainingQueue];
    });
    logQueueEvent(`Returned to ${previousEntry.photo.original_filename}`, {
      photoId: previousEntry.photo.id,
      previousAction: previousEntry.action,
    });
    setError("");
  }

  function handlePeopleChange(nextSelectedPeopleIds) {
    setSelectedPeopleIds(nextSelectedPeopleIds);
  }

  function applySuggestedPeople() {
    if (
      !currentSuggestionState?.people ||
      currentSuggestionState.people.length === 0
    ) {
      return;
    }

    const peopleByName = new Map(
      (people || []).map((person) => [person.name.toLowerCase(), person]),
    );
    const nextIds = currentSuggestionState.people
      .map((name) => peopleByName.get(String(name).toLowerCase()))
      .filter(Boolean)
      .map((person) => person.id);

    setSelectedPeopleIds([...new Set(nextIds)]);
    setFieldSelection((currentValue) => ({
      ...currentValue,
      people: true,
    }));
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/60 p-4 2xl:p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[94vh] w-[96vw] max-w-[1700px] overflow-hidden border border-stone-300 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex min-w-0 flex-1 flex-col border-r border-stone-200">
          <div className="border-b border-stone-200 px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-stone-500">
                  Analyze Queue
                </p>
                <h2 className="mt-2 text-xl font-semibold text-stone-900">
                  {queue.length > 0
                    ? `${queue.length} photo${queue.length === 1 ? "" : "s"} remaining`
                    : "Queue complete"}
                </h2>
                {currentPhoto ? (
                  <div className="mt-2 space-y-1 text-sm text-stone-500">
                    <p>{currentPhoto.original_filename}</p>
                    <p>{formatCapturedDateTime(currentPhoto.captured_at)}</p>
                    <p>{formatPhotoLocation(currentPhoto)}</p>
                  </div>
                ) : null}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={history.length === 0 || isApplying || isReanalyzing}
                  className="btn-secondary px-4 py-2 text-sm"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-secondary px-4 py-2 text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>

          {currentPhoto ? (
            <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-0 2xl:grid-cols-[620px_minmax(0,1fr)]">
              <div className="flex min-h-0 flex-col overflow-hidden border-r border-stone-200 p-6">
                <div className="mx-auto flex h-[400px] w-[400px] max-w-full shrink-0 items-center justify-center overflow-hidden border border-stone-300 bg-stone-100 2xl:h-[620px] 2xl:w-[620px]">
                  {currentPhoto.large_url ? (
                    <img
                      src={currentPhoto.large_url}
                      alt={
                        currentPhoto.alt_text || currentPhoto.original_filename
                      }
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm text-stone-500">
                      No image available
                    </div>
                  )}
                </div>

                <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-2">
                  <div className="grid gap-3 text-sm text-stone-600">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                        Current Title
                      </p>
                      <p className="mt-1 text-stone-800">
                        {currentPhoto.title || "Not set"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                        Current Tags
                      </p>
                      <p className="mt-1 text-stone-800">
                        {currentPhoto.tags && currentPhoto.tags.length > 0
                          ? currentPhoto.tags.join(", ")
                          : "No tags yet"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                        Prefetch Buffer
                      </p>
                      <div className="mt-2 space-y-2">
                        {prefetchedPhotos.length > 0 ? (
                          prefetchedPhotos.map((photo, index) => {
                            const analysis =
                              analysisByPhotoId[photo.id] || null;
                            const statusLabel =
                              analysis?.status === "done"
                                ? "Ready"
                                : analysis?.status === "loading"
                                  ? "Analyzing..."
                                  : analysis?.status === "error"
                                    ? "Failed"
                                    : "Waiting";

                            return (
                              <div key={photo.id}>
                                <p className="text-stone-800">
                                  {index + 1}. {photo.original_filename}
                                </p>
                                <p className="mt-1 text-xs text-stone-500">
                                  {statusLabel}
                                </p>
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-stone-800">
                            No more photos in queue
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="border border-stone-300 bg-stone-50 p-3">
                      <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                        Queue Activity
                      </p>
                      <div className="mt-2 max-h-[180px] space-y-2 overflow-y-auto pr-1">
                        {activityLog.length > 0 ? (
                          activityLog.map((entry) => (
                            <p
                              key={entry.id}
                              className="text-xs leading-5 text-stone-600"
                            >
                              <span className="font-medium text-stone-800">
                                {entry.time}
                              </span>{" "}
                              {entry.message}
                            </p>
                          ))
                        ) : (
                          <p className="text-xs text-stone-500">
                            No queue activity yet.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                  <div className="space-y-5">
                    <label className="block rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                      <div className="mb-2 flex items-center justify-between gap-4">
                        <span className="text-xs uppercase tracking-[0.24em] text-amber-800">
                          Notes for AI
                        </span>
                        <label className="inline-flex items-center gap-2 text-sm text-amber-900">
                          <input
                            type="checkbox"
                            checked={fieldSelection.notes}
                            onChange={() => toggleField("notes")}
                            className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-400"
                          />
                          Apply notes
                        </label>
                      </div>
                      <textarea
                        value={notesForAi}
                        onChange={(event) => setNotesForAi(event.target.value)}
                        className="field min-h-[120px] resize-y border-amber-300 bg-white/90"
                      />
                      {!currentNotesMatchSavedValue ? (
                        <p className="mt-2 text-sm text-amber-900/80">
                          Notes changed. Click reanalyze to regenerate
                          suggestions using these notes.
                        </p>
                      ) : null}
                    </label>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={handleReanalyze}
                        disabled={isApplying || isReanalyzing}
                        className="btn-secondary"
                      >
                        {isReanalyzing ? "Reanalyzing..." : "Reanalyze"}
                      </button>
                      {!currentAnalysisIsFresh &&
                      currentAnalysis?.suggestions ? (
                        <span className="text-sm text-amber-700">
                          Suggestions below were generated before your latest
                          notes change.
                        </span>
                      ) : null}
                    </div>

                    <section className="border border-stone-300 bg-stone-50 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                          People
                        </p>
                        <label className="inline-flex items-center gap-2 text-sm text-stone-700">
                          <input
                            type="checkbox"
                            checked={fieldSelection.people}
                            onChange={() => toggleField("people")}
                            className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
                          />
                          Apply people
                        </label>
                      </div>

                      {currentSuggestionState?.people &&
                      currentSuggestionState.people.length > 0 ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span className="text-sm text-stone-600">
                            AI suggestion:{" "}
                            {currentSuggestionState.people.join(", ")}
                          </span>
                          <button
                            type="button"
                            onClick={applySuggestedPeople}
                            className="btn-secondary px-3 py-1.5 text-sm"
                          >
                            Use Suggestion
                          </button>
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-stone-500">
                          No family member suggestion for this photo.
                        </p>
                      )}

                      <div className="mt-4">
                        <PeopleSelector
                          selectedIds={selectedPeopleIds}
                          people={people}
                          onChange={handlePeopleChange}
                        />
                      </div>
                    </section>

                    {currentAnalysis?.status === "loading" ? (
                      <div className="border border-stone-300 bg-stone-50 px-4 py-5 text-sm text-stone-600">
                        Analyzing photo...
                      </div>
                    ) : currentAnalysis?.status === "error" ? (
                      <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                        {currentAnalysis.error}
                      </div>
                    ) : currentSuggestionState ? (
                      <>
                        <div className="grid gap-5 2xl:grid-cols-2">
                          <SuggestionField
                            checked={fieldSelection.title}
                            onToggle={() => toggleField("title")}
                            label="Title"
                            value={
                              currentSuggestionState.title ||
                              "No title suggestion."
                            }
                          />

                          <SuggestionField
                            checked={fieldSelection.altText}
                            onToggle={() => toggleField("altText")}
                            label="Alt Text"
                            value={
                              currentSuggestionState.altText ||
                              "No alt text suggestion."
                            }
                            multiline
                          />
                        </div>

                        <SuggestionField
                          checked={fieldSelection.aiCaption}
                          onToggle={() => toggleField("aiCaption")}
                          label="AI Caption"
                          value={
                            currentSuggestionState.aiCaption ||
                            "No caption suggestion."
                          }
                          multiline
                        />

                        <section className="border border-stone-300 bg-stone-50 p-4">
                          <div className="flex items-center justify-between gap-4">
                            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                              Tags
                            </p>
                            <label className="inline-flex items-center gap-2 text-sm text-stone-700">
                              <input
                                type="checkbox"
                                checked={fieldSelection.tags}
                                onChange={() => toggleField("tags")}
                                className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
                              />
                              Apply tags
                            </label>
                          </div>

                          {currentSuggestionState.tagRecords.length > 0 ? (
                            <>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {currentSuggestionState.tagRecords.map(
                                  (tag) => (
                                    <span
                                      key={tag.name}
                                      className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700"
                                    >
                                      <span
                                        className={`h-2.5 w-2.5 rounded-full border border-stone-400 ${getGroupColorClass(tag.groupColor)}`}
                                      />
                                      <span>{tag.name}</span>
                                    </span>
                                  ),
                                )}
                              </div>
                              <p className="mt-3 text-sm text-stone-600">
                                Resulting tags:{" "}
                                {currentSuggestionState.tags.join(", ")}
                              </p>
                            </>
                          ) : (
                            <p className="mt-2 text-sm text-stone-500">
                              No tag suggestions.
                            </p>
                          )}
                        </section>
                      </>
                    ) : (
                      <div className="border border-stone-300 bg-stone-50 px-4 py-5 text-sm text-stone-600">
                        Waiting for analysis to start...
                      </div>
                    )}

                    {error ? (
                      <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                        {error}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="border-t border-stone-200 px-6 py-4">
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleApplyAndAdvance}
                      disabled={
                        isApplying ||
                        isReanalyzing ||
                        currentAnalysis?.status === "loading" ||
                        !currentSuggestionState
                      }
                      className="btn-primary"
                    >
                      {isApplying ? "Applying..." : "Apply and Next"}
                    </button>
                    <button
                      type="button"
                      onClick={handleSkip}
                      disabled={isApplying}
                      className="btn-secondary"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center px-8 py-12 text-center">
              <div>
                <p className="text-lg font-semibold text-stone-900">
                  Analyze queue complete
                </p>
                <p className="mt-2 text-sm text-stone-500">
                  There are no more incomplete photos in this queue.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SuggestionField({
  checked,
  onToggle,
  label,
  value,
  multiline = false,
}) {
  return (
    <section className="border border-stone-300 bg-stone-50 p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
          {label}
        </p>
        <label className="inline-flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
          />
          Apply
        </label>
      </div>
      <p
        className={`mt-3 text-stone-800 ${multiline ? "text-sm leading-6" : "text-base"}`}
      >
        {value}
      </p>
    </section>
  );
}
