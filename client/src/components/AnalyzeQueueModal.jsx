import { useEffect, useMemo, useRef, useState } from "react";
import { generateCaption, getPhotoCorrectionPreview, updatePhoto } from "../api";
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
  const expressionTags = (suggestions.expressionTags || []).map((tag) =>
    typeof tag === "string" ? { name: tag } : tag,
  );
  const combinedTagSuggestions = [...(suggestions.tags || []), ...expressionTags];
  const tagByKey = new Map(
    (knownTags || []).map((tag) => [normalizeTagKey(tag.name), tag]),
  );
  const groupByName = new Map(
    (tagGroups || []).map((group) => [normalizeTagKey(group.name), group]),
  );
  const mergedTags = mergeTags(photo.tags || [], combinedTagSuggestions);

  return {
    people: suggestions.people || [],
    facePrematchPeople: suggestions.facePrematchPeople || [],
    facePrematchFaces: suggestions.facePrematchFaces || [],
    expressionTags,
    editRecipe: suggestions.editRecipe || null,
    title: suggestions.title || "",
    aiCaption: suggestions.aiCaption || "",
    altText: suggestions.altText || "",
    tags: mergedTags,
    tagRecords: combinedTagSuggestions.map((tag) => {
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
    photoCorrection: Boolean(suggestionState.editRecipe?.apply),
    title: Boolean(suggestionState.title),
    aiCaption: Boolean(suggestionState.aiCaption),
    altText: Boolean(suggestionState.altText),
    tags: suggestionState.tagRecords.length > 0,
  };
}

function buildAnalyzeErrorMessage(error) {
  return error?.message || "Failed to analyze photo";
}

function formatConfidence(score) {
  const numericScore = Number(score);

  if (!Number.isFinite(numericScore) || numericScore <= 0) {
    return "0%";
  }

  return `${Math.round(numericScore * 100)}%`;
}

function getFaceOverlayLabel(face) {
  if (face?.top_name) {
    return `${face.top_name} ${formatConfidence(face.top_score)}`;
  }

  const topCandidate = Array.isArray(face?.candidates) ? face.candidates[0] : null;

  if (topCandidate?.name) {
    return `${topCandidate.name}? ${formatConfidence(topCandidate.score)}`;
  }

  return `Face ${Number(face?.face_index) + 1 || ""}`.trim();
}

const FACE_PREMATCH_ACCENTS = [
  {
    border: "#10b981",
    badge: "#10b981",
    soft: "#ecfdf5",
    text: "#065f46",
  },
  {
    border: "#f59e0b",
    badge: "#f59e0b",
    soft: "#fffbeb",
    text: "#92400e",
  },
  {
    border: "#3b82f6",
    badge: "#3b82f6",
    soft: "#eff6ff",
    text: "#1d4ed8",
  },
  {
    border: "#ec4899",
    badge: "#ec4899",
    soft: "#fdf2f8",
    text: "#9d174d",
  },
  {
    border: "#8b5cf6",
    badge: "#8b5cf6",
    soft: "#f5f3ff",
    text: "#6d28d9",
  },
  {
    border: "#14b8a6",
    badge: "#14b8a6",
    soft: "#f0fdfa",
    text: "#115e59",
  },
];

function getFaceAccent(faceIndex) {
  const numericIndex = Number(faceIndex);
  const safeIndex = Number.isFinite(numericIndex) ? numericIndex : 0;
  return FACE_PREMATCH_ACCENTS[safeIndex % FACE_PREMATCH_ACCENTS.length];
}

function getImageOverlayMetrics(imageElement) {
  if (!imageElement) {
    return null;
  }

  const renderedWidth = imageElement.clientWidth;
  const renderedHeight = imageElement.clientHeight;
  const naturalWidth = imageElement.naturalWidth;
  const naturalHeight = imageElement.naturalHeight;

  if (!renderedWidth || !renderedHeight || !naturalWidth || !naturalHeight) {
    return null;
  }

  return {
    left: imageElement.offsetLeft,
    top: imageElement.offsetTop,
    renderedWidth,
    renderedHeight,
    naturalWidth,
    naturalHeight,
  };
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

function buildRecipeCacheKey(photoId, editRecipe) {
  if (!photoId || !editRecipe) {
    return "";
  }

  return `${photoId}:${JSON.stringify(editRecipe)}`;
}

function getCurrentFaceMatchIds(suggestionState) {
  return new Set(
    (suggestionState?.facePrematchFaces || [])
      .map((face) => Number(face?.id))
      .filter(Number.isFinite),
  );
}

export default function AnalyzeQueueModal({
  isOpen,
  photos,
  startPhotoId,
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
    photoCorrection: false,
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
  const [initialQueueLength, setInitialQueueLength] = useState(0);
  const [correctionPreviewByKey, setCorrectionPreviewByKey] = useState({});
  const [isPreviewLightboxOpen, setIsPreviewLightboxOpen] = useState(false);
  const [acceptedFaceMatchIds, setAcceptedFaceMatchIds] = useState([]);
  const [rejectedFaceMatchIds, setRejectedFaceMatchIds] = useState([]);
  const [previewImageMetrics, setPreviewImageMetrics] = useState(null);
  const [lightboxImageMetrics, setLightboxImageMetrics] = useState(null);
  const analysisByPhotoIdRef = useRef({});
  const wasOpenRef = useRef(false);
  const correctionPreviewByKeyRef = useRef({});
  const bodyScrollRef = useRef(null);
  const previewImageRef = useRef(null);
  const lightboxImageRef = useRef(null);

  useEffect(() => {
    analysisByPhotoIdRef.current = analysisByPhotoId;
  }, [analysisByPhotoId]);

  useEffect(() => {
    correctionPreviewByKeyRef.current = correctionPreviewByKey;
  }, [correctionPreviewByKey]);

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
    const startIndex = photos.findIndex((photo) => photo.id === startPhotoId);
    const orderedQueue = startIndex > 0
      ? [...photos.slice(startIndex), ...photos.slice(0, startIndex)]
      : photos;

    setQueue(orderedQueue);
    setInitialQueueLength(orderedQueue.length);
    setAnalysisByPhotoId({});
    setError("");
    setActivityLog([]);
    setHistory([]);
    setCorrectionPreviewByKey((currentValue) => {
      Object.values(currentValue).forEach((entry) => {
        if (entry?.url) {
          URL.revokeObjectURL(entry.url);
        }
      });

      return {};
    });
    correctionPreviewByKeyRef.current = {};
    console.info("[AnalyzeQueue] opened", {
      queueLength: orderedQueue.length,
      startPhotoId,
      photoIds: orderedQueue.map((photo) => photo.id),
    });
  }, [isOpen, photos, startPhotoId]);

  useEffect(
    () => () => {
      Object.values(correctionPreviewByKeyRef.current).forEach((entry) => {
        if (entry?.url) {
          URL.revokeObjectURL(entry.url);
        }
      });
    },
    [],
  );

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
  const currentCorrectionPreviewKey = buildRecipeCacheKey(
    currentPhoto?.id,
    currentSuggestionState?.editRecipe,
  );
  const currentCorrectionPreview =
    correctionPreviewByKey[currentCorrectionPreviewKey] || null;
  const correctionPreviewUrl = currentCorrectionPreview?.url || "";
  const isLoadingCorrectionPreview =
    currentCorrectionPreview?.status === "loading";
  const correctionPreviewError = currentCorrectionPreview?.error || "";

  useEffect(() => {
    if (!currentPhoto) {
      setNotesForAi("");
      setFieldSelection({
        notes: false,
        people: false,
        photoCorrection: false,
        title: false,
        aiCaption: false,
        altText: false,
        tags: false,
      });
      setSelectedPeopleIds([]);
      setAcceptedFaceMatchIds([]);
      setRejectedFaceMatchIds([]);
      return;
    }

    const nextNotes = currentPhoto.notes_for_ai || "";
    setNotesForAi(nextNotes);
    setSelectedPeopleIds(
      (currentPhoto.people || []).map((person) => person.id),
    );
    setAcceptedFaceMatchIds([]);
    setRejectedFaceMatchIds([]);
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
        photoCorrection: false,
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
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollTop = 0;
    }
  }, [currentPhoto?.id]);

  useEffect(() => {
    function handleResize() {
      setPreviewImageMetrics(getImageOverlayMetrics(previewImageRef.current));
      setLightboxImageMetrics(getImageOverlayMetrics(lightboxImageRef.current));
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  async function ensureCorrectionPreview(photo, editRecipe, reason) {
    const cacheKey = buildRecipeCacheKey(photo?.id, editRecipe);

    if (!cacheKey) {
      return null;
    }

    const existingPreview = correctionPreviewByKeyRef.current[cacheKey];

    if (existingPreview?.status === "done" || existingPreview?.status === "loading") {
      return existingPreview;
    }

    logQueueEvent(`Starting correction preview for ${photo.original_filename}`, {
      photoId: photo.id,
      reason,
    });

    correctionPreviewByKeyRef.current = {
      ...correctionPreviewByKeyRef.current,
      [cacheKey]: {
        status: "loading",
        url: existingPreview?.url || "",
        error: "",
      },
    };

    setCorrectionPreviewByKey((currentValue) => ({
      ...currentValue,
      [cacheKey]: {
        status: "loading",
        url: currentValue[cacheKey]?.url || "",
        error: "",
      },
    }));

    try {
      const blob = await getPhotoCorrectionPreview(photo.id, editRecipe, {
        previewWidth: 1280,
      });
      const objectUrl = URL.createObjectURL(blob);

      correctionPreviewByKeyRef.current = {
        ...correctionPreviewByKeyRef.current,
        [cacheKey]: {
          status: "done",
          url: objectUrl,
          error: "",
        },
      };

      setCorrectionPreviewByKey((currentValue) => {
        const existingValue = currentValue[cacheKey];

        if (existingValue?.url) {
          URL.revokeObjectURL(existingValue.url);
        }

        return {
          ...currentValue,
          [cacheKey]: {
            status: "done",
            url: objectUrl,
            error: "",
          },
        };
      });

      logQueueEvent(`Finished correction preview for ${photo.original_filename}`, {
        photoId: photo.id,
        reason,
      });

      return { status: "done", url: objectUrl, error: "" };
    } catch (previewError) {
      const message =
        previewError.message || "Failed to load correction preview";

      correctionPreviewByKeyRef.current = {
        ...correctionPreviewByKeyRef.current,
        [cacheKey]: {
          status: "error",
          url: "",
          error: message,
        },
      };

      setCorrectionPreviewByKey((currentValue) => ({
        ...currentValue,
        [cacheKey]: {
          status: "error",
          url: "",
          error: message,
        },
      }));

      logQueueEvent(`Correction preview failed for ${photo.original_filename}`, {
        photoId: photo.id,
        reason,
        error: message,
      });

      return null;
    }
  }

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

  useEffect(() => {
    if (!isOpen || !currentPhoto) {
      return;
    }

    const recipe = analysisByPhotoId[currentPhoto.id]?.suggestions?.editRecipe;

    if (!recipe) {
      return;
    }

    void ensureCorrectionPreview(currentPhoto, recipe, "current-preview");
  }, [analysisByPhotoId, currentPhoto, isOpen]);

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
        facePrematchPeople: response?.data?.face_prematch_people || [],
        facePrematchFaces: response?.data?.face_prematch_faces || [],
        expressionTags: response?.data?.suggested_expression_tags || [],
        editRecipe: response?.data?.edit_recipe || null,
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
      const currentFaceMatchIds = getCurrentFaceMatchIds(currentSuggestionState);
      const acceptedFaceMatchIdsForPhoto = acceptedFaceMatchIds.filter((id) =>
        currentFaceMatchIds.has(id),
      );
      const rejectedFaceMatchIdsForPhoto = rejectedFaceMatchIds.filter((id) =>
        currentFaceMatchIds.has(id),
      );

      if (fieldSelection.notes) {
        payload.notes_for_ai = notesForAi;
      }

      if (fieldSelection.people) {
        payload.people = selectedPeopleIds;
      }

      if (acceptedFaceMatchIdsForPhoto.length > 0) {
        payload.accept_face_match_ids = acceptedFaceMatchIdsForPhoto;
      }

      if (rejectedFaceMatchIdsForPhoto.length > 0) {
        payload.reject_face_match_ids = rejectedFaceMatchIdsForPhoto;
      }

      if (currentSuggestionState.editRecipe) {
        payload.edit_recipe = currentSuggestionState.editRecipe;
        payload.apply_photo_correction = fieldSelection.photoCorrection;
        payload.skip_photo_correction = !fieldSelection.photoCorrection;
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

  function applyFaceCandidate(face, candidate) {
    const faceMatchId = Number(face?.id);
    const personId = Number(candidate?.person_id);

    if (!Number.isFinite(faceMatchId) || !Number.isFinite(personId)) {
      return;
    }

    setSelectedPeopleIds((currentValue) => [
      ...new Set([...currentValue, personId]),
    ]);
    setFieldSelection((currentValue) => ({
      ...currentValue,
      people: true,
    }));

    const topCandidatePersonId = Number(
      face?.top_person_id || face?.candidates?.[0]?.person_id,
    );

    if (topCandidatePersonId === personId) {
      setAcceptedFaceMatchIds((currentValue) => [
        ...new Set([...currentValue, faceMatchId]),
      ]);
      setRejectedFaceMatchIds((currentValue) =>
        currentValue.filter((id) => id !== faceMatchId),
      );
      return;
    }

    setRejectedFaceMatchIds((currentValue) => [
      ...new Set([...currentValue, faceMatchId]),
    ]);
    setAcceptedFaceMatchIds((currentValue) =>
      currentValue.filter((id) => id !== faceMatchId),
    );
  }

  function rejectFacePrematchFace(face) {
    const faceMatchId = Number(face?.id);

    if (!Number.isFinite(faceMatchId)) {
      return;
    }

    setRejectedFaceMatchIds((currentValue) => [
      ...new Set([...currentValue, faceMatchId]),
    ]);
    setAcceptedFaceMatchIds((currentValue) =>
      currentValue.filter((id) => id !== faceMatchId),
    );
  }

  if (!isOpen) {
    return null;
  }

  const currentPhotoAnalysisStatus = currentAnalysis?.status || "idle";
  const currentPhotoStatusLabel =
    currentPhotoAnalysisStatus === "done"
      ? currentSuggestionState?.editRecipe
        ? isLoadingCorrectionPreview
          ? "Analysis ready, preparing preview..."
          : correctionPreviewUrl
            ? "Ready"
            : correctionPreviewError
              ? "Analysis ready, preview failed"
              : "Analysis ready"
        : "Ready"
      : currentPhotoAnalysisStatus === "loading"
        ? "Analyzing..."
        : currentPhotoAnalysisStatus === "error"
          ? "Analysis failed"
          : "Waiting";
  const progressValue =
    initialQueueLength > 0
      ? Math.max(0, initialQueueLength - queue.length) / initialQueueLength
      : 0;
  const displayedPreviewUrl =
    fieldSelection.photoCorrection && correctionPreviewUrl
      ? correctionPreviewUrl
      : currentPhoto?.large_url || "";
  const currentFaceRows = (currentSuggestionState?.facePrematchFaces || []).map((face) => {
    const accent = getFaceAccent(face?.face_index);
    const faceMatchId = Number(face?.id);
    const isAccepted = Number.isFinite(faceMatchId) && acceptedFaceMatchIds.includes(faceMatchId);
    const isRejected = Number.isFinite(faceMatchId) && rejectedFaceMatchIds.includes(faceMatchId);

    return {
      face,
      accent,
      isAccepted,
      isRejected,
      candidates: Array.isArray(face?.candidates)
        ? face.candidates.filter((candidate) => Number(candidate?.person_id)).slice(0, 3)
        : [],
    };
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-stone-950/60"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col bg-white shadow-2xl lg:mx-auto lg:h-[94vh] lg:max-w-4xl lg:border lg:border-stone-300"
        onClick={(event) => event.stopPropagation()}
      >
        {currentPhoto ? (
          <>
            <div className="sticky top-0 z-10 border-b border-stone-200 bg-white">
              <div className="px-4 py-3 lg:px-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <p className="shrink-0 text-sm font-medium text-stone-700">
                        {queue.length > 0
                          ? `${queue.length} remaining`
                          : "Queue complete"}
                      </p>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200">
                        <div
                          className="h-full rounded-full transition-[width]"
                          style={{
                            width: `${Math.max(0, Math.min(100, progressValue * 100))}%`,
                            backgroundImage: "linear-gradient(-225deg, #FF057C 0%, #8D0B93 50%, #321575 100%)",
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-700 transition hover:border-stone-400 hover:bg-stone-100"
                      aria-label="Close"
                    >
                      <i className="ti ti-x text-base" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-500">
                  <span className="min-w-0 truncate font-medium text-stone-900">
                    {currentPhoto.original_filename}
                  </span>
                  <span className="text-stone-300">·</span>
                  <span>{formatCapturedDateTime(currentPhoto.captured_at)}</span>
                  <span className="text-stone-300">·</span>
                  <span>{formatPhotoLocation(currentPhoto)}</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    {currentPhotoStatusLabel}
                  </span>
                </div>
              </div>

              <div className="border-t border-stone-200 px-4 py-3 lg:px-6">
                <div className="mx-auto w-full max-w-3xl overflow-hidden border border-stone-300 bg-stone-300">
                  <button
                    type="button"
                    onClick={() => {
                      if (displayedPreviewUrl) {
                        setIsPreviewLightboxOpen(true);
                      }
                    }}
                    className="block w-full"
                    aria-label="Open preview larger"
                  >
                    <div className="relative h-[28vh] min-h-[160px] max-h-[28vh] bg-stone-300 sm:min-h-[180px] sm:h-[32vh] sm:max-h-[32vh] lg:h-[40vh] lg:min-h-[220px] lg:max-h-[40vh]">
                      {displayedPreviewUrl ? (
                        <>
                          <div className="absolute inset-0 flex items-center justify-center p-2">
                            <img
                              ref={previewImageRef}
                              src={displayedPreviewUrl}
                              alt={currentPhoto.alt_text || currentPhoto.original_filename}
                              className="block max-h-full max-w-full object-contain"
                              onLoad={(event) => {
                                setPreviewImageMetrics(
                                  getImageOverlayMetrics(event.currentTarget),
                                );
                              }}
                            />
                          </div>
                          <FacePrematchOverlay
                            faces={currentFaceRows}
                            metrics={previewImageMetrics}
                          />
                        </>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-sm text-stone-600">
                          No image available
                        </div>
                      )}
                      <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-stone-950/75 px-2.5 py-1 text-xs font-medium text-white">
                        {fieldSelection.photoCorrection ? "Corrected" : "Original"}
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            <div ref={bodyScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-6">
              <div className="mx-auto w-full max-w-3xl space-y-5">
                {currentSuggestionState?.editRecipe ? (
                  <section className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <p className="inline-flex items-center gap-2 text-[11px] font-medium text-stone-500">
                        <i className="ti ti-wand text-base" aria-hidden="true" />
                        <span>Photo correction</span>
                      </p>
                      <label className="inline-flex items-center gap-2 text-sm text-stone-700">
                        <input
                          type="checkbox"
                          checked={fieldSelection.photoCorrection}
                          onChange={() => toggleField("photoCorrection")}
                          className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
                        />
                        Apply photo correction
                      </label>
                    </div>
                    {currentSuggestionState.editRecipe.notes ? (
                      <p className="mt-2 text-sm text-stone-600">
                        {currentSuggestionState.editRecipe.notes}
                      </p>
                    ) : null}
                  </section>
                ) : null}

                <label className="block rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <span className="inline-flex items-center gap-2 text-[11px] font-medium text-amber-800">
                      <i className="ti ti-message-2 text-base" aria-hidden="true" />
                      <span>Notes for AI</span>
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
                      Notes changed. Click reanalyze to regenerate suggestions using these notes.
                    </p>
                  ) : null}
                </label>

                <section className="border border-stone-300 bg-stone-50 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="inline-flex items-center gap-2 text-[11px] font-medium text-stone-500">
                      <i className="ti ti-users text-base" aria-hidden="true" />
                      <span>People</span>
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
                        AI suggestion: {currentSuggestionState.people.join(", ")}
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

                  {currentFaceRows.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      <p className="text-sm text-stone-600">
                        Local face prematch:
                      </p>
                      <div className="space-y-2">
                        {currentFaceRows.map(({ face, accent, isAccepted, isRejected, candidates }) => {
                          return (
                            <div
                              key={face.id || face.face_index}
                              className="rounded-xl border bg-white px-3 py-3 text-sm text-stone-700"
                              style={{
                                borderColor: accent.border,
                                boxShadow: `inset 0 0 0 1px ${accent.border}22`,
                              }}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
                                  style={{
                                    backgroundColor: accent.soft,
                                    color: accent.text,
                                  }}
                                >
                                  Face {Number(face.face_index) + 1}
                                </span>
                                <span className="text-sm text-stone-700">
                                  {getFaceOverlayLabel(face)}
                                </span>
                                {isAccepted ? (
                                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-700">
                                    selected
                                  </span>
                                ) : null}
                                {isRejected ? (
                                  <span className="rounded-full bg-red-100 px-2 py-1 text-xs text-red-700">
                                    rejected
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {candidates.map((candidate, index) => {
                                  const isPrimary =
                                    Number(candidate.person_id) === Number(face.top_person_id || face.candidates?.[0]?.person_id);

                                  return (
                                    <button
                                      key={`${face.id || face.face_index}-${candidate.person_id}`}
                                      type="button"
                                      onClick={() => applyFaceCandidate(face, candidate)}
                                      className={`rounded-full px-3 py-1.5 text-sm ${
                                        isPrimary
                                          ? "bg-stone-900 text-white"
                                          : "border border-stone-300 bg-white text-stone-700"
                                      }`}
                                    >
                                      {candidate.name} {formatConfidence(candidate.score)}
                                    </button>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={() => rejectFacePrematchFace(face)}
                                  className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-sm text-red-700"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4">
                    <PeopleSelector
                      selectedIds={selectedPeopleIds}
                      people={people}
                      onChange={handlePeopleChange}
                    />
                  </div>
                </section>

                <section className="space-y-3">
                  {!currentAnalysisIsFresh &&
                  currentAnalysis?.suggestions ? (
                    <p className="text-sm text-amber-700">
                      Suggestions below were generated before your latest notes change.
                    </p>
                  ) : null}

                  {currentAnalysis?.status === "loading" ? (
                    <div className="border border-stone-300 bg-stone-50 px-4 py-5 text-sm text-stone-600">
                      Analyzing photo...
                    </div>
                  ) : null}

                  {currentAnalysis?.status === "error" ? (
                    <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                      {currentAnalysis.error}
                    </div>
                  ) : null}

                  {error ? (
                    <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                      {error}
                    </div>
                  ) : null}
                </section>

                {currentAnalysis?.status !== "loading" &&
                currentAnalysis?.status !== "error" &&
                currentSuggestionState ? (
                  <>
                    <SuggestionField
                      icon="ti-heading"
                      checked={fieldSelection.title}
                      onToggle={() => toggleField("title")}
                      label="Title"
                      value={currentSuggestionState.title || "No title suggestion."}
                    />

                    <SuggestionField
                      icon="ti-quote"
                      checked={fieldSelection.aiCaption}
                      onToggle={() => toggleField("aiCaption")}
                      label="AI Caption"
                      value={currentSuggestionState.aiCaption || "No caption suggestion."}
                      multiline
                    />

                    <SuggestionField
                      icon="ti-text-caption"
                      checked={fieldSelection.altText}
                      onToggle={() => toggleField("altText")}
                      label="Alt Text"
                      value={currentSuggestionState.altText || "No alt text suggestion."}
                      multiline
                    />

                    <section className="border border-stone-300 bg-stone-50 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="inline-flex items-center gap-2 text-[11px] font-medium text-stone-500">
                          <i className="ti ti-tags text-base" aria-hidden="true" />
                          <span>Tags</span>
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
                            {currentSuggestionState.tagRecords.map((tag) => (
                              <span
                                key={tag.name}
                                className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700"
                              >
                                <span
                                  className={`h-2.5 w-2.5 rounded-full border border-stone-400 ${getGroupColorClass(tag.groupColor)}`}
                                />
                                <span>{tag.name}</span>
                              </span>
                            ))}
                          </div>
                          {currentSuggestionState.expressionTags.length > 0 ? (
                            <p className="mt-3 text-sm text-stone-600">
                              Includes local expression tags:{" "}
                              {currentSuggestionState.expressionTags
                                .map((tag) => tag.name || tag)
                                .join(", ")}
                            </p>
                          ) : null}
                          <p className="mt-3 text-sm text-stone-600">
                            Resulting tags: {currentSuggestionState.tags.join(", ")}
                          </p>
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-stone-500">
                          No tag suggestions.
                        </p>
                      )}
                    </section>

                    <details className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 text-sm text-stone-700">
                      <summary className="cursor-pointer list-none text-[11px] font-medium text-stone-500">
                        <span className="inline-flex items-center gap-2">
                          <i className="ti ti-info-circle text-base" aria-hidden="true" />
                          Details
                        </span>
                      </summary>

                      <div className="mt-4 space-y-4">
                        <div>
                          <p className="text-[11px] font-medium text-stone-500">
                            Local face prematch
                          </p>
                          <div className="mt-2 space-y-2">
                            {currentSuggestionState.facePrematchFaces.length > 0 ? (
                              currentSuggestionState.facePrematchFaces.map((face) => (
                                <div key={face.id} className="text-stone-800">
                                  <p>
                                    Face {face.face_index + 1}: {face.top_name || "No confident match"}{" "}
                                    {face.top_name ? `(${formatConfidence(face.top_score)})` : ""}
                                  </p>
                                  <p className="mt-1 text-xs text-stone-500">
                                    Expressions: {face.suggested_expression_tags?.length > 0
                                      ? face.suggested_expression_tags
                                        .map((tag) => tag.name)
                                        .join(", ")
                                      : "none"}
                                  </p>
                                  <p className="mt-1 text-xs text-stone-500">
                                    Candidates: {face.candidates?.length > 0
                                      ? face.candidates
                                        .map((candidate) => `${candidate.name} ${formatConfidence(candidate.score)}`)
                                        .join(", ")
                                      : "none"}
                                  </p>
                                </div>
                              ))
                            ) : (
                              <p className="text-stone-800">
                                No local face prematch data.
                              </p>
                            )}
                          </div>
                        </div>

                        <div>
                          <p className="text-[11px] font-medium text-stone-500">
                            Current title
                          </p>
                          <p className="mt-1 text-stone-800">
                            {currentPhoto.title || "Not set"}
                          </p>
                        </div>

                        <div>
                          <p className="text-[11px] font-medium text-stone-500">
                            Current tags
                          </p>
                          <p className="mt-1 text-stone-800">
                            {currentPhoto.tags && currentPhoto.tags.length > 0
                              ? currentPhoto.tags.join(", ")
                              : "No tags yet"}
                          </p>
                        </div>

                        <div>
                          <p className="text-[11px] font-medium text-stone-500">
                            Prefetch buffer
                          </p>
                          <div className="mt-2 space-y-2">
                            {prefetchedPhotos.length > 0 ? (
                              prefetchedPhotos.map((photo, index) => {
                                const analysis =
                                  analysisByPhotoId[photo.id] || null;
                                const previewKey = buildRecipeCacheKey(
                                  photo.id,
                                  analysis?.suggestions?.editRecipe,
                                );
                                const previewState =
                                  correctionPreviewByKey[previewKey] || null;
                                const statusLabel =
                                  analysis?.status === "done"
                                    ? analysis?.suggestions?.editRecipe
                                      ? previewState?.status === "done"
                                        ? "Ready"
                                        : previewState?.status === "loading"
                                          ? "Previewing..."
                                          : previewState?.status === "error"
                                            ? "Preview failed"
                                            : "Analysis ready"
                                      : "Ready"
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

                        <div className="border border-stone-300 bg-white p-3">
                          <p className="text-[11px] font-medium text-stone-500">
                            Queue activity
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
                    </details>
                  </>
                ) : currentAnalysis?.status === "loading" ||
                  currentAnalysis?.status === "error" ? null : (
                  <div className="border border-stone-300 bg-stone-50 px-4 py-5 text-sm text-stone-600">
                    Waiting for analysis to start...
                  </div>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 border-t border-stone-200 bg-white px-4 py-4 lg:px-6">
              <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleBack}
                    disabled={history.length === 0 || isApplying || isReanalyzing}
                    className="btn-secondary"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleSkip}
                    disabled={isApplying}
                    className="btn-secondary"
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={handleReanalyze}
                    disabled={isApplying || isReanalyzing}
                    className={isApplying || isReanalyzing ? "btn-secondary" : "ai-button"}
                  >
                    {isReanalyzing ? (
                      "Reanalyzing..."
                    ) : (
                      <>
                        <i className="ti ti-sparkles text-base" aria-hidden="true" />
                        <span>Reanalyze</span>
                      </>
                    )}
                  </button>
                </div>

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
              </div>
            </div>
          </>
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

      {isPreviewLightboxOpen && displayedPreviewUrl ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/85 p-4"
          onClick={() => setIsPreviewLightboxOpen(false)}
        >
          <div
            className="relative max-h-full max-w-[min(96vw,1400px)]"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsPreviewLightboxOpen(false)}
              className="absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-stone-900 shadow"
              aria-label="Close preview"
            >
              <i className="ti ti-x text-base" aria-hidden="true" />
            </button>
            <img
              ref={lightboxImageRef}
              src={displayedPreviewUrl}
              alt={currentPhoto?.alt_text || currentPhoto?.original_filename || "Preview"}
              className="max-h-[90vh] max-w-full border border-stone-300 bg-white object-contain shadow-2xl"
              onLoad={(event) => {
                setLightboxImageMetrics(
                  getImageOverlayMetrics(event.currentTarget),
                );
              }}
            />
            <FacePrematchOverlay
              faces={currentFaceRows}
              metrics={lightboxImageMetrics}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SuggestionField({
  icon,
  checked,
  onToggle,
  label,
  value,
  multiline = false,
}) {
  return (
    <section className="border border-stone-300 bg-stone-50 p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="inline-flex items-center gap-2 text-[11px] font-medium text-stone-500">
          {icon ? <i className={`ti ${icon} text-base`} aria-hidden="true" /> : null}
          <span>{label}</span>
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

function FacePrematchOverlay({ faces, metrics }) {
  if (!metrics || !Array.isArray(faces) || faces.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {faces.map((entry) => {
        const face = entry?.face || entry;
        const accent = entry?.accent || getFaceAccent(face?.face_index);
        const box = face?.box || {};
        const left = metrics.left + (Number(box.x) / metrics.naturalWidth) * metrics.renderedWidth;
        const top = metrics.top + (Number(box.y) / metrics.naturalHeight) * metrics.renderedHeight;
        const width = (Number(box.width) / metrics.naturalWidth) * metrics.renderedWidth;
        const height = (Number(box.height) / metrics.naturalHeight) * metrics.renderedHeight;

        if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
          return null;
        }

        return (
          <div
            key={face.id || face.face_index}
            className="absolute border-2 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
            style={{
              left,
              top,
              width,
              height,
              borderColor: accent.border,
            }}
          >
            <div
              className="absolute left-0 top-0 -translate-y-full rounded-t-md px-2 py-1 text-[11px] font-medium leading-none text-white shadow"
              style={{ backgroundColor: accent.badge }}
            >
              {getFaceOverlayLabel(face)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
