import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDestinations,
  getJournalEntries,
  getPhotos,
  searchSemantic,
  getVideos,
  updatePhoto,
  uploadPhotos
} from "../api";
import AnalyzeQueueModal from "./AnalyzeQueueModal";
import BulkActionBar from "./BulkActionBar";
import PhotoEditor from "./PhotoEditor";
import PhotoFilters from "./PhotoFilters";
import PhotoGrid from "./PhotoGrid";
import VideoEditor from "./VideoEditor";

const CONTENT_TYPE_OPTIONS = [
  { id: "all", label: "All", disabled: false },
  { id: "photos", label: "Photos", disabled: false },
  { id: "videos", label: "Videos", disabled: false },
  { id: "journal", label: "Journal", disabled: false }
];

const CONTENT_TYPE_TO_SEMANTIC_TYPE = {
  photos: "photo",
  videos: "video",
  journal: "journal"
};

const TIMELINE_SECTION_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "1200px"
};

const TIMELINE_CARD_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "260px"
};

function formatMonthRange(dateStart, dateEnd) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  return `${formatter.format(new Date(dateStart))} – ${formatter.format(new Date(dateEnd))}`;
}

function formatJournalDate(value) {
  if (!value) {
    return "Unknown date";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(parsed);
}

function formatVideoDuration(totalSeconds) {
  const seconds = Number(totalSeconds || 0);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function getPhotoTimestamp(photo) {
  const value = photo.captured_at || photo.uploaded_at;
  const timestamp = value ? new Date(value).getTime() : Number.NaN;

  return Number.isNaN(timestamp) ? null : timestamp;
}

function getVideoTimestamp(video) {
  const value = video.date_filmed || video.date_published || video.created_at;
  const timestamp = value ? new Date(value).getTime() : Number.NaN;

  return Number.isNaN(timestamp) ? null : timestamp;
}

function getJournalTimestamp(entry) {
  const timestamp = entry?.entry_date ? new Date(entry.entry_date).getTime() : Number.NaN;
  return Number.isNaN(timestamp) ? null : timestamp;
}

function sortPhotosForDisplay(photos, sortDirection) {
  const sorted = [...photos];

  sorted.sort((left, right) => {
    const leftTime = getPhotoTimestamp(left) ?? 0;
    const rightTime = getPhotoTimestamp(right) ?? 0;

    if (sortDirection === "oldest") {
      return leftTime - rightTime || left.id - right.id;
    }

    return rightTime - leftTime || right.id - left.id;
  });

  return sorted;
}

function sortVideosForDisplay(videos, sortDirection) {
  const sorted = [...videos];

  sorted.sort((left, right) => {
    const leftTime = getVideoTimestamp(left) ?? 0;
    const rightTime = getVideoTimestamp(right) ?? 0;

    if (sortDirection === "oldest") {
      return leftTime - rightTime || left.id - right.id;
    }

    return rightTime - leftTime || right.id - left.id;
  });

  return sorted;
}

function parseCsvList(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatSemanticResultType(type) {
  if (type === "photo") {
    return "Photo";
  }

  if (type === "video") {
    return "Video";
  }

  return "Journal";
}

function formatSemanticScore(score) {
  const numericScore = Number(score);

  if (!Number.isFinite(numericScore)) {
    return null;
  }

  return `${Math.round(numericScore * 100)}%`;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia("(max-width: 1023.98px)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023.98px)");
    const handler = (event) => setIsMobile(event.matches);

    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}

export default function TimelineView({ people, tags, tagGroups }) {
  const isMobile = useIsMobile();
  const [destinations, setDestinations] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [videos, setVideos] = useState([]);
  const [journalEntries, setJournalEntries] = useState([]);
  const [filters, setFilters] = useState({});
  const [sortDirection, setSortDirection] = useState("newest");
  const [contentType, setContentType] = useState("all");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [editingPhoto, setEditingPhoto] = useState(null);
  const [editingVideo, setEditingVideo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [activeDropZone, setActiveDropZone] = useState("");
  const [isUploadingToDestination, setIsUploadingToDestination] = useState(false);
  const [expandedJournalEntryIds, setExpandedJournalEntryIds] = useState(new Set());
  const [isAnalyzeQueueOpen, setIsAnalyzeQueueOpen] = useState(false);
  const [analyzeQueueOrder, setAnalyzeQueueOrder] = useState("newest");
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [activeFilterCount, setActiveFilterCount] = useState(0);
  const [semanticQueryInput, setSemanticQueryInput] = useState("");
  const [activeSemanticQuery, setActiveSemanticQuery] = useState("");
  const [semanticResults, setSemanticResults] = useState(null);
  const [isSemanticLoading, setIsSemanticLoading] = useState(false);
  const [semanticError, setSemanticError] = useState("");
  const contentScrollRef = useRef(null);
  const filterSheetStartYRef = useRef(0);
  const filterSheetCanDragRef = useRef(false);
  const filterSheetScrollRef = useRef(null);
  const [filterSheetOffsetY, setFilterSheetOffsetY] = useState(0);

  function syncLoadedPhotos(nextPhotos, { resetSelection = false } = {}) {
    setPhotos(nextPhotos);

    if (resetSelection) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds((currentSelectedIds) => new Set(
        [...currentSelectedIds].filter((photoId) => nextPhotos.some((photo) => photo.id === photoId))
      ));
    }

    setEditingPhoto((currentPhoto) => {
      if (!currentPhoto) {
        return null;
      }

      return nextPhotos.find((photo) => photo.id === currentPhoto.id) || null;
    });
  }

  function syncLoadedVideos(nextVideos) {
    setVideos(nextVideos);
    setEditingVideo((currentVideo) => {
      if (!currentVideo) {
        return null;
      }

      return nextVideos.find((video) => video.id === currentVideo.id) || null;
    });
  }

  useEffect(() => {
    let isActive = true;

    async function loadTimelineData() {
      setIsLoading(true);
      setError("");

      try {
        const [destinationsResponse, photosResponse, videosResponse, journalEntriesResponse] = await Promise.all([
          getDestinations(),
          getPhotos(filters),
          getVideos(),
          getJournalEntries()
        ]);

        if (!isActive) {
          return;
        }

        setDestinations(destinationsResponse?.data || []);
        syncLoadedPhotos(photosResponse?.data || [], { resetSelection: true });
        syncLoadedVideos(videosResponse?.data || []);
        setJournalEntries(journalEntriesResponse?.data || []);
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setError(loadError.message || "Failed to load timeline");
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadTimelineData();

    return () => {
      isActive = false;
    };
  }, [filters, refreshNonce]);

  const hasPendingPhotoProcessing = photos.some((photo) => (
    photo.processing_status === "queued" ||
    photo.processing_status === "processing" ||
    photo.geo_status === "queued"
  ));

  useEffect(() => {
    if (!hasPendingPhotoProcessing) {
      return undefined;
    }

    let isActive = true;

    const intervalId = window.setInterval(async () => {
      try {
        const photosResponse = await getPhotos(filters);

        if (!isActive) {
          return;
        }

        syncLoadedPhotos(photosResponse?.data || []);
      } catch (pollError) {
        if (!isActive) {
          return;
        }

        setError(pollError.message || "Failed to refresh photos");
      }
    }, 3000);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [filters, hasPendingPhotoProcessing]);

  const groupedTimeline = useMemo(() => {
    const photosByDestinationId = new Map(destinations.map((destination) => [destination.id, []]));
    const videosByDestinationId = new Map(destinations.map((destination) => [destination.id, []]));
    const journalEntriesByDestinationId = new Map(destinations.map((destination) => [destination.id, []]));
    const undatedPhotos = [];
    const undatedVideos = [];
    const undatedJournalEntries = [];
    const brandedVideos = [];

    for (const photo of photos) {
      if (!photo.captured_at) {
        undatedPhotos.push(photo);
        continue;
      }

      const matchingDestination = findMatchingDestinationForPhoto(photo, destinations);

      if (!matchingDestination) {
        undatedPhotos.push(photo);
        continue;
      }

      photosByDestinationId.get(matchingDestination.id).push(photo);
    }

    for (const video of videos) {
      if (video.video_category && video.video_category !== "travel") {
        brandedVideos.push(video);
        continue;
      }

      const matchingDestination = findMatchingDestinationForVideo(video, destinations);

      if (!matchingDestination) {
        undatedVideos.push(video);
        continue;
      }

      videosByDestinationId.get(matchingDestination.id).push(video);
    }

    for (const journalEntry of journalEntries) {
      const matchingDestination = findMatchingDestinationForJournalEntry(journalEntry, destinations);

      if (!matchingDestination) {
        undatedJournalEntries.push(journalEntry);
        continue;
      }

      journalEntriesByDestinationId.get(matchingDestination.id).push(journalEntry);
    }

    const destinationBlocks = [...destinations]
      .sort((left, right) => {
        const comparison = new Date(left.date_start).getTime() - new Date(right.date_start).getTime();
        return sortDirection === "oldest" ? comparison : -comparison;
      })
      .map((destination) => ({
        ...destination,
        photos: sortPhotosForDisplay(photosByDestinationId.get(destination.id) || [], sortDirection),
        videos: sortVideosForDisplay(videosByDestinationId.get(destination.id) || [], sortDirection),
        journalEntries: sortJournalEntriesForDisplay(journalEntriesByDestinationId.get(destination.id) || [], sortDirection)
      }));

    return {
      destinations: destinationBlocks,
      undatedPhotos: sortPhotosForDisplay(undatedPhotos, sortDirection),
      undatedVideos: sortVideosForDisplay(undatedVideos, sortDirection),
      undatedJournalEntries: sortJournalEntriesForDisplay(undatedJournalEntries, sortDirection),
      brandedVideos: sortVideosForDisplay(brandedVideos, sortDirection)
    };
  }, [destinations, journalEntries, photos, videos, sortDirection]);

  const activeMissingFilters = useMemo(() => parseCsvList(filters.missing), [filters.missing]);
  const showNoContentDestinations = activeMissingFilters.includes("no_content");

  const displayedDestinations = useMemo(() => {
    if (!showNoContentDestinations) {
      return groupedTimeline.destinations;
    }

    return groupedTimeline.destinations.filter((destination) => (
      destination.photos.length === 0
      && destination.videos.length === 0
      && destination.journalEntries.length === 0
    ));
  }, [groupedTimeline.destinations, showNoContentDestinations]);

  const locationOptions = useMemo(() => ({
    neighborhoods: buildUniqueLocationOptions(photos, "neighborhood"),
    cities: buildUniqueLocationOptions([
      ...photos.map((photo) => ({ city: photo.city })),
      ...videos.map((video) => ({ city: video.filmed_city }))
    ], "city"),
    regions: buildUniqueLocationOptions(photos, "region"),
    countries: buildUniqueLocationOptions([
      ...photos.map((photo) => ({ country: photo.country })),
      ...videos.map((video) => ({ country: video.filmed_country }))
    ], "country")
  }), [photos, videos]);
  const isBulkEditing = selectedIds.size > 1;
  const hasActiveEditorContent = isBulkEditing || Boolean(editingVideo) || Boolean(editingPhoto);
  const hasActiveFilters = Object.entries(filters).some(([, value]) => {
    if (value === undefined || value === null) {
      return false;
    }

    if (typeof value === "string") {
      return value.trim() !== "";
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return Boolean(value);
  });

  function handleApplyFilters(nextFilters) {
    setFilters(nextFilters);
  }

  function handleClearFilters() {
    setFilters({});
  }

  async function handleSemanticSearchSubmit(event) {
    event.preventDefault();

    const query = semanticQueryInput.trim();

    if (!query) {
      setActiveSemanticQuery("");
      setSemanticResults(null);
      setSemanticError("");
      return;
    }

    setIsSemanticLoading(true);
    setSemanticError("");

    try {
      const response = await searchSemantic({
        query,
        limit: 15,
        ...(CONTENT_TYPE_TO_SEMANTIC_TYPE[contentType]
          ? { content_types: [CONTENT_TYPE_TO_SEMANTIC_TYPE[contentType]] }
          : {})
      });

      setActiveSemanticQuery(query);
      setSemanticResults(response?.data || null);
    } catch (searchError) {
      setSemanticError(searchError.message || "Failed to run AI search");
      setActiveSemanticQuery(query);
      setSemanticResults(null);
    } finally {
      setIsSemanticLoading(false);
    }
  }

  function handleClearSemanticSearch() {
    setSemanticQueryInput("");
    setActiveSemanticQuery("");
    setSemanticResults(null);
    setSemanticError("");
  }

  function handleSavedPhoto(updatedPhoto) {
    setPhotos((currentPhotos) => currentPhotos.map((currentPhoto) => (
      currentPhoto.id === updatedPhoto.id ? updatedPhoto : currentPhoto
    )));
    setEditingPhoto((currentPhoto) => (
      currentPhoto?.id === updatedPhoto.id ? updatedPhoto : currentPhoto
    ));
  }

  function handleDeletedPhoto(photoId) {
    setPhotos((currentPhotos) => currentPhotos.filter((photo) => photo.id !== photoId));
    setSelectedIds((currentSelectedIds) => {
      const nextSelectedIds = new Set(currentSelectedIds);
      nextSelectedIds.delete(photoId);
      return nextSelectedIds;
    });
    setEditingPhoto(null);
  }

  function handleSavedVideo(updatedVideo) {
    setVideos((currentVideos) => currentVideos.map((currentVideo) => (
      currentVideo.id === updatedVideo.id ? updatedVideo : currentVideo
    )));
    setEditingVideo(updatedVideo);
  }

  function handleDeletedVideo(videoId) {
    setVideos((currentVideos) => currentVideos.filter((video) => video.id !== videoId));
    setEditingVideo(null);
  }

  async function refreshPhotosPreservingView({ resetSelection = false } = {}) {
    const scrollTop = contentScrollRef.current?.scrollTop ?? 0;
    const photosResponse = await getPhotos(filters);
    const nextPhotos = photosResponse?.data || [];

    syncLoadedPhotos(nextPhotos, { resetSelection });

    window.requestAnimationFrame(() => {
      if (contentScrollRef.current) {
        contentScrollRef.current.scrollTop = scrollTop;
      }
    });
  }

  async function handleBulkAction() {
    try {
      await refreshPhotosPreservingView();
    } catch (refreshError) {
      setError(refreshError.message || "Failed to refresh photos");
    }
  }

  async function handleDestinationDrop(destination, fileList) {
    const files = Array.from(fileList || []);

    if (files.length === 0 || isUploadingToDestination) {
      return;
    }

    setIsUploadingToDestination(true);
    setError("");
    setActiveDropZone(destination.id);

    try {
      const response = await uploadPhotos(files);
      const results = response?.data || [];

      for (const result of results) {
        const uploadedPhoto = result?.photo;

        if (!uploadedPhoto) {
          continue;
        }

        const hasLocationEvidence =
          uploadedPhoto.latitude !== null && uploadedPhoto.latitude !== undefined &&
          uploadedPhoto.longitude !== null && uploadedPhoto.longitude !== undefined;

        if (!uploadedPhoto.city && !hasLocationEvidence) {
          await updatePhoto(uploadedPhoto.id, {
            city: destination.city,
            country: destination.country
          });
        }
      }

      setRefreshNonce((currentValue) => currentValue + 1);
    } catch (uploadError) {
      setError(uploadError.message || "Failed to upload photos to destination");
    } finally {
      setIsUploadingToDestination(false);
      setActiveDropZone("");
    }
  }

  const filteredPhotos = useMemo(() => sortPhotosForDisplay(photos, sortDirection), [photos, sortDirection]);
  const visiblePhotosInOrder = useMemo(() => {
    if (hasActiveFilters && !showNoContentDestinations) {
      return contentType === "videos" ? [] : filteredPhotos;
    }

    const orderedPhotos = [];

    if (contentType !== "videos") {
      for (const destination of displayedDestinations) {
        orderedPhotos.push(...destination.photos);
      }
    }

    if (!showNoContentDestinations && contentType !== "videos") {
      orderedPhotos.push(...groupedTimeline.undatedPhotos);
    }

    return orderedPhotos;
  }, [
    contentType,
    displayedDestinations,
    filteredPhotos,
    groupedTimeline.undatedPhotos,
    hasActiveFilters,
    showNoContentDestinations
  ]);

  const analyzeQueuePhotos = useMemo(() => {
    const pendingPhotos = visiblePhotosInOrder.filter((photo) => isPhotoPendingAnalyze(photo));

    if (analyzeQueueOrder === sortDirection) {
      return pendingPhotos;
    }

    return [...pendingPhotos].reverse();
  }, [analyzeQueueOrder, sortDirection, visiblePhotosInOrder]);
  const analyzeQueueStartPhotoId = useMemo(() => {
    const selectedPhotoId = editingPhoto?.id || null;

    if (selectedPhotoId && analyzeQueuePhotos.some((photo) => photo.id === selectedPhotoId)) {
      return selectedPhotoId;
    }

    return null;
  }, [analyzeQueuePhotos, editingPhoto?.id]);

  function navigateEditingPhoto(direction) {
    if (!editingPhoto || visiblePhotosInOrder.length === 0) {
      return;
    }

    const currentIndex = visiblePhotosInOrder.findIndex((photo) => photo.id === editingPhoto.id);

    if (currentIndex === -1) {
      return;
    }

    const nextIndex = currentIndex + direction;

    if (nextIndex < 0 || nextIndex >= visiblePhotosInOrder.length) {
      return;
    }

    setEditingVideo(null);
    setEditingPhoto(visiblePhotosInOrder[nextIndex]);
  }

  function closeFilterPanel() {
    setIsFilterPanelOpen(false);
    setFilterSheetOffsetY(0);
  }

  function handleFilterSheetTouchStart(event) {
    if (!isMobile || !isFilterPanelOpen) {
      return;
    }

    filterSheetCanDragRef.current = (filterSheetScrollRef.current?.scrollTop || 0) <= 0;
    filterSheetStartYRef.current = event.touches[0]?.clientY || 0;
  }

  function handleFilterSheetTouchMove(event) {
    if (!isMobile || !isFilterPanelOpen) {
      return;
    }

    const currentY = event.touches[0]?.clientY || 0;
    const nextOffset = Math.max(0, currentY - filterSheetStartYRef.current);

    if (!filterSheetCanDragRef.current || nextOffset === 0) {
      return;
    }

    setFilterSheetOffsetY(nextOffset);
  }

  function handleFilterSheetTouchEnd() {
    if (!isMobile || !isFilterPanelOpen) {
      return;
    }

    filterSheetCanDragRef.current = false;

    if (filterSheetOffsetY > 80) {
      closeFilterPanel();
      return;
    }

    setFilterSheetOffsetY(0);
  }

  function openSemanticResult(result) {
    if (!result?.record) {
      return;
    }

    if (result.type === "photo") {
      const fullPhoto = photos.find((photo) => photo.id === result.record.id) || result.record;
      setEditingVideo(null);
      setEditingPhoto(fullPhoto);
      return;
    }

    if (result.type === "video") {
      const fullVideo = videos.find((video) => video.id === result.record.id) || result.record;
      setEditingPhoto(null);
      setEditingVideo(fullVideo);
    }
  }

  return (
    <>
      <div className="relative flex min-h-0 flex-1 gap-6 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <section className="panel mb-4 px-5 py-4">
          <div className="hidden flex-wrap items-center justify-between gap-4 lg:flex">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex overflow-hidden rounded-xl border border-stone-300 bg-white">
                {CONTENT_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => {
                      if (!option.disabled) {
                        setContentType(option.id);
                      }
                    }}
                    className={`px-3.5 py-2 text-sm font-medium transition ${
                      option.disabled
                        ? "text-stone-400"
                        : contentType === option.id
                          ? "bg-stone-900 text-stone-50"
                          : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                    } ${option.id !== CONTENT_TYPE_OPTIONS[CONTENT_TYPE_OPTIONS.length - 1].id ? "border-r border-stone-300" : ""}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <label className="relative block w-[180px]">
                <select
                  value={sortDirection}
                  onChange={(event) => setSortDirection(event.target.value)}
                  className="field appearance-none pr-10"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-stone-500">
                  <i className="ti ti-chevron-down text-base" />
                </span>
              </label>

              <form onSubmit={handleSemanticSearchSubmit} className="flex items-center gap-3">
                <label className="relative block w-[360px]">
                  <input
                    type="search"
                    value={semanticQueryInput}
                    onChange={(event) => setSemanticQueryInput(event.target.value)}
                    placeholder="AI search across photos, videos, journals"
                    className="field pl-11"
                  />
                  <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-stone-500">
                    <i className="ti ti-sparkles text-base" aria-hidden="true" />
                  </span>
                </label>
                <button type="submit" className="ai-button">
                  Search
                </button>
                {(activeSemanticQuery || semanticQueryInput) ? (
                  <button type="button" onClick={handleClearSemanticSearch} className="btn-secondary">
                    Clear
                  </button>
                ) : null}
              </form>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setIsFilterPanelOpen((currentValue) => !currentValue)}
                className="btn-secondary gap-3"
                aria-expanded={isFilterPanelOpen}
              >
                <i className="ti ti-adjustments-horizontal text-base" aria-hidden="true" />
                <span>Filters</span>
                <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700">
                  {activeFilterCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIsAnalyzeQueueOpen(true)}
                disabled={contentType === "videos" || contentType === "journal" || analyzeQueuePhotos.length === 0}
                className={contentType === "videos" || contentType === "journal" || analyzeQueuePhotos.length === 0 ? "btn-secondary gap-3 opacity-50" : "ai-button"}
              >
                <i className="ti ti-sparkles text-base" aria-hidden="true" />
                <span>Analyze Queue</span>
                <span
                  className={
                    contentType === "videos" || contentType === "journal" || analyzeQueuePhotos.length === 0
                      ? "rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700"
                      : "rounded-full bg-white/15 px-2 py-0.5 text-xs text-stone-50"
                  }
                >
                  {analyzeQueuePhotos.length}
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-3 lg:hidden">
            <form onSubmit={handleSemanticSearchSubmit} className="flex items-center gap-3">
              <label className="relative block min-w-0 flex-1">
                <input
                  type="search"
                  value={semanticQueryInput}
                  onChange={(event) => setSemanticQueryInput(event.target.value)}
                  placeholder="AI search"
                  className="field pl-11"
                />
                <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-stone-500">
                  <i className="ti ti-sparkles text-base" aria-hidden="true" />
                </span>
              </label>
              <button type="submit" className="ai-button px-4">
                Go
              </button>
            </form>

            <div className="inline-flex w-full overflow-hidden rounded-xl border border-stone-300 bg-white">
              {CONTENT_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => {
                    if (!option.disabled) {
                      setContentType(option.id);
                    }
                  }}
                  className={`flex-1 px-3 py-2 text-sm font-medium transition ${
                    option.disabled
                      ? "text-stone-400"
                      : contentType === option.id
                        ? "bg-stone-900 text-stone-50"
                        : "text-stone-600 hover:bg-stone-50 hover:text-stone-900"
                  } ${option.id !== CONTENT_TYPE_OPTIONS[CONTENT_TYPE_OPTIONS.length - 1].id ? "border-r border-stone-300" : ""}`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsFilterPanelOpen((currentValue) => !currentValue)}
                className="btn-secondary flex-1 justify-between gap-3"
                aria-expanded={isFilterPanelOpen}
              >
                <span className="inline-flex items-center gap-3">
                  <i className="ti ti-adjustments-horizontal text-base" aria-hidden="true" />
                  <span>Sort &amp; filters</span>
                </span>
                <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700">
                  {activeFilterCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIsAnalyzeQueueOpen(true)}
                disabled={contentType === "videos" || contentType === "journal" || analyzeQueuePhotos.length === 0}
                aria-label={`Analyze Queue ${analyzeQueuePhotos.length}`}
                className={contentType === "videos" || contentType === "journal" || analyzeQueuePhotos.length === 0 ? "btn-secondary gap-2 opacity-50" : "ai-button gap-2 px-3"}
              >
                <i className="ti ti-sparkles text-base" aria-hidden="true" />
                <span className={contentType === "videos" || contentType === "journal" || analyzeQueuePhotos.length === 0 ? "rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700" : "rounded-full bg-white/15 px-2 py-0.5 text-xs text-stone-50"}>
                  {analyzeQueuePhotos.length}
                </span>
              </button>
            </div>
          </div>

          <div
            className={`lg:static lg:z-auto lg:translate-y-0 ${
              isMobile
                ? `fixed inset-x-0 bottom-0 z-50 rounded-t-[1.75rem] border border-stone-300 bg-white ${
                    isFilterPanelOpen ? "pointer-events-auto" : "pointer-events-none"
                  }`
                : ""
            } lg:rounded-none lg:border-0 lg:bg-transparent`}
            onTouchStart={handleFilterSheetTouchStart}
            onTouchMove={handleFilterSheetTouchMove}
            onTouchEnd={handleFilterSheetTouchEnd}
            style={{
              transform: isMobile
                ? (isFilterPanelOpen ? `translateY(${filterSheetOffsetY}px)` : "translateY(calc(100% + 2rem))")
                : "translateY(0)",
              transition: isMobile && filterSheetOffsetY > 0 ? "none" : "transform 180ms ease-out"
            }}
          >
            <div
              ref={filterSheetScrollRef}
              className="max-h-[82vh] overflow-y-auto lg:max-h-none lg:overflow-visible"
            >
              <div className="relative px-5 pt-3 lg:hidden">
                <div className="mx-auto h-1.5 w-12 rounded-full bg-stone-300" />
                <button
                  type="button"
                  onClick={closeFilterPanel}
                  className="absolute right-5 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-700"
                  aria-label="Close sort and filters"
                >
                  <i className="ti ti-x text-base" aria-hidden="true" />
                </button>
              </div>

              <div className="px-5 pb-6 pt-2 lg:hidden">
                <label className="block w-full">
                  <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Sort</span>
                  <div className="relative">
                    <select
                      value={sortDirection}
                      onChange={(event) => setSortDirection(event.target.value)}
                      className="field appearance-none pr-10"
                    >
                      <option value="newest">Newest First</option>
                      <option value="oldest">Oldest First</option>
                    </select>
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-stone-500">
                      <i className="ti ti-chevron-down text-base" />
                    </span>
                  </div>
                </label>
              </div>

              <PhotoFilters
                people={people}
                tags={tags}
                locationOptions={locationOptions}
                onApply={handleApplyFilters}
                onClear={handleClearFilters}
                isOpen={isFilterPanelOpen}
                onActiveFilterCountChange={setActiveFilterCount}
                wrapperClassName="px-5 pb-6 pt-5 lg:border-t lg:border-stone-200 lg:px-5 lg:py-5"
              />
            </div>
          </div>
        </section>

        <div
          className={`fixed inset-0 z-40 bg-stone-950/35 transition lg:hidden ${
            isMobile && isFilterPanelOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          }`}
          onClick={closeFilterPanel}
        />

        {error ? (
          <div className="panel mb-4 border-red-300/70 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {semanticError ? (
          <div className="panel mb-4 border-red-300/70 bg-red-50 px-4 py-3 text-sm text-red-700">
            {semanticError}
          </div>
        ) : null}

        {isLoading ? (
          <section className="panel flex min-h-[360px] items-center justify-center p-8">
            <div className="text-center">
              <p className="text-sm font-medium text-stone-700">Loading timeline...</p>
              <p className="mt-2 text-sm text-stone-500">Fetching destinations, photos, and videos.</p>
              <p className="mt-1 text-sm text-stone-500">Loading journal entries too.</p>
            </div>
          </section>
        ) : activeSemanticQuery ? (
          <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden p-6">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-500">AI Search</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-900">
                  {activeSemanticQuery}
                </h2>
                <p className="mt-2 text-sm text-stone-500">
                  Natural-language results across photos, videos, and journal entries.
                </p>
              </div>

              <button type="button" onClick={handleClearSemanticSearch} className="btn-secondary">
                Clear Search
              </button>
            </div>

            {isSemanticLoading ? (
              <div className="flex min-h-[240px] items-center justify-center border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-sm text-stone-500">
                Running AI search...
              </div>
            ) : !semanticResults || semanticResults.items.length === 0 ? (
              <div className="flex min-h-[240px] items-center justify-center border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-sm text-stone-500">
                No AI search results found for this query.
              </div>
            ) : (
              <div ref={contentScrollRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                <div className="mb-4 flex flex-wrap gap-3 text-xs uppercase tracking-[0.22em] text-stone-500">
                  <span>{semanticResults.total_hits} hits</span>
                  <span>{semanticResults.photos.length} photos</span>
                  <span>{semanticResults.videos.length} videos</span>
                  <span>{semanticResults.journals.length} journals</span>
                </div>

                <div className="space-y-4">
                  {semanticResults.items.map((result, index) => {
                    const scoreLabel = formatSemanticScore(result.score);
                    const isClickable = result.type === "photo" || result.type === "video";

                    return (
                      <article
                        key={`${result.type}-${result.record.id}-${index}`}
                        className="rounded-[1.5rem] border border-stone-200 bg-white p-5 shadow-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-xs uppercase tracking-[0.22em] text-stone-500">
                              {formatSemanticResultType(result.type)}
                            </p>
                            <h3 className="mt-2 text-xl font-semibold text-stone-900">
                              {result.record.title || result.record.original_filename || "Untitled"}
                            </h3>
                          </div>

                          <div className="flex items-center gap-2">
                            {scoreLabel ? (
                              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                                Match {scoreLabel}
                              </span>
                            ) : null}
                            {isClickable ? (
                              <button
                                type="button"
                                onClick={() => openSemanticResult(result)}
                                className="btn-secondary"
                              >
                                Open
                              </button>
                            ) : null}
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 text-sm text-stone-600 md:grid-cols-3">
                          <p>
                            <span className="font-medium text-stone-900">Date:</span>{" "}
                            {result.record.captured_at || result.record.published_at || result.record.date || "Unknown"}
                          </p>
                          <p>
                            <span className="font-medium text-stone-900">City:</span>{" "}
                            {result.record.city || "Unknown"}
                          </p>
                          <p>
                            <span className="font-medium text-stone-900">Country:</span>{" "}
                            {result.record.country || "Unknown"}
                          </p>
                        </div>

                        {result.record.people?.length > 0 ? (
                          <p className="mt-4 text-sm text-stone-600">
                            <span className="font-medium text-stone-900">People:</span>{" "}
                            {result.record.people.map((person) => person.name).join(", ")}
                          </p>
                        ) : null}

                        {result.record.tags?.length > 0 ? (
                          <p className="mt-2 text-sm text-stone-600">
                            <span className="font-medium text-stone-900">Tags:</span>{" "}
                            {result.record.tags.join(", ")}
                          </p>
                        ) : null}

                        {result.excerpt ? (
                          <p className="mt-4 rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700">
                            {result.excerpt}
                          </p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        ) : hasActiveFilters && !showNoContentDestinations ? (
          <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden p-6">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Filtered Results</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-900">
                  Showing filtered results — {filteredPhotos.length} photo{filteredPhotos.length === 1 ? "" : "s"}
                </h2>
              </div>

              <button type="button" onClick={handleClearFilters} className="btn-secondary">
                Clear Filters
              </button>
            </div>

            {contentType === "videos" || contentType === "journal" ? (
              <div className="flex min-h-[240px] items-center justify-center border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-sm text-stone-500">
                {contentType === "videos"
                  ? "Video results do not use the photo filters."
                  : "Journal results do not use the photo filters."}
              </div>
            ) : (
              <div ref={contentScrollRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
                <PhotoGrid
                  photos={filteredPhotos}
                  onPhotoClick={(photo) => {
                    setEditingVideo(null);
                    setEditingPhoto(photo);
                  }}
                  selectedIds={selectedIds}
                  onSelectionChange={setSelectedIds}
                  embedded
                  showSortControl={false}
                />
              </div>
            )}
          </section>
        ) : (
          <div ref={contentScrollRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div className="space-y-8 pb-4">
              {displayedDestinations.map((destination) => {
                const visiblePhotos = contentType === "videos" || contentType === "journal" ? [] : destination.photos;
                const visibleVideos = contentType === "photos" || contentType === "journal" ? [] : destination.videos;
                const visibleJournalEntries = contentType === "photos" || contentType === "videos"
                  ? []
                  : destination.journalEntries;
                const hasVisibleContent =
                  visiblePhotos.length > 0 || visibleVideos.length > 0 || visibleJournalEntries.length > 0;

                return (
                  <section key={destination.id} style={TIMELINE_SECTION_STYLE} className="border border-stone-300 bg-white">
                    <div className="border-b border-stone-200 px-5 py-4">
                      <div className="flex flex-wrap items-end justify-between gap-4">
                        <div>
                          <h2 className="text-2xl font-semibold text-stone-900">
                            {destination.city}, {destination.country}
                          </h2>
                          <p className="mt-2 text-sm text-stone-500">
                            {formatMonthRange(destination.date_start, destination.date_end)}
                            {" · "}
                            {destination.duration_days || "?"} days
                            {" · "}
                            {destination.photos.length} photo{destination.photos.length === 1 ? "" : "s"}
                            {" · "}
                            {destination.videos.length} video{destination.videos.length === 1 ? "" : "s"}
                            {" · "}
                            {destination.journalEntries.length} journal entr{destination.journalEntries.length === 1 ? "y" : "ies"}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-5 px-5 py-5">
                      {visiblePhotos.length > 0 ? (
                        <PhotoGrid
                          photos={visiblePhotos}
                          onPhotoClick={(photo) => {
                            setEditingVideo(null);
                            setEditingPhoto(photo);
                          }}
                          selectedIds={selectedIds}
                          onSelectionChange={setSelectedIds}
                          embedded
                          showSortControl={false}
                        />
                      ) : null}

                      {visibleVideos.length > 0 ? (
                        <VideoGrid
                          videos={visibleVideos}
                          onVideoClick={(video) => {
                            setEditingPhoto(null);
                            setEditingVideo(video);
                          }}
                        />
                      ) : null}

                      {visibleJournalEntries.length > 0 ? (
                        <JournalEntryList
                          entries={visibleJournalEntries}
                          expandedIds={expandedJournalEntryIds}
                          onToggleExpand={(entryId) => {
                            setExpandedJournalEntryIds((currentValue) => {
                              const nextValue = new Set(currentValue);

                              if (nextValue.has(entryId)) {
                                nextValue.delete(entryId);
                              } else {
                                nextValue.add(entryId);
                              }

                              return nextValue;
                            });
                          }}
                        />
                      ) : null}

                      {!hasVisibleContent && contentType !== "videos" && contentType !== "journal" ? (
                        <DestinationDropZone
                          destination={destination}
                          isActive={activeDropZone === destination.id}
                          isUploading={isUploadingToDestination && activeDropZone === destination.id}
                          onDragEnter={() => setActiveDropZone(destination.id)}
                          onDragLeave={() => {
                            if (!isUploadingToDestination) {
                              setActiveDropZone("");
                            }
                          }}
                          onDropFiles={(files) => handleDestinationDrop(destination, files)}
                        />
                      ) : null}
                    </div>
                  </section>
                );
              })}

              {contentType !== "photos" && contentType !== "journal" && groupedTimeline.brandedVideos.length > 0 ? (
                <section style={TIMELINE_SECTION_STYLE} className="border border-stone-300 bg-white">
                  <div className="border-b border-stone-200 px-5 py-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Brand & Sponsored Content</p>
                    <h2 className="mt-2 text-2xl font-semibold text-stone-900">Brand & Sponsored Content</h2>
                    <p className="mt-2 text-sm text-stone-500">
                      {groupedTimeline.brandedVideos.length} video{groupedTimeline.brandedVideos.length === 1 ? "" : "s"}
                    </p>
                  </div>

                  <div className="px-5 py-5">
                    <VideoGrid
                      videos={groupedTimeline.brandedVideos}
                      onVideoClick={(video) => {
                        setEditingPhoto(null);
                        setEditingVideo(video);
                      }}
                    />
                  </div>
                </section>
              ) : null}

              {!showNoContentDestinations ? (
                <section style={TIMELINE_SECTION_STYLE} className="border border-stone-300 bg-white">
                  <div className="border-b border-stone-200 px-5 py-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Undated</p>
                    <h2 className="mt-2 text-2xl font-semibold text-stone-900">Undated Content</h2>
                    <p className="mt-2 text-sm text-stone-500">
                      {groupedTimeline.undatedPhotos.length} photo{groupedTimeline.undatedPhotos.length === 1 ? "" : "s"}
                      {" · "}
                      {groupedTimeline.undatedVideos.length} video{groupedTimeline.undatedVideos.length === 1 ? "" : "s"}
                      {" · "}
                      {groupedTimeline.undatedJournalEntries.length} journal entr{groupedTimeline.undatedJournalEntries.length === 1 ? "y" : "ies"}
                    </p>
                  </div>

                  <div className="space-y-5 px-5 py-5">
                    {contentType !== "videos" && contentType !== "journal" && groupedTimeline.undatedPhotos.length > 0 ? (
                      <PhotoGrid
                        photos={groupedTimeline.undatedPhotos}
                        onPhotoClick={(photo) => {
                          setEditingVideo(null);
                          setEditingPhoto(photo);
                        }}
                        selectedIds={selectedIds}
                        onSelectionChange={setSelectedIds}
                        embedded
                        showSortControl={false}
                      />
                    ) : null}

                    {contentType !== "photos" && contentType !== "journal" && groupedTimeline.undatedVideos.length > 0 ? (
                      <VideoGrid
                        videos={groupedTimeline.undatedVideos}
                        onVideoClick={(video) => {
                          setEditingPhoto(null);
                          setEditingVideo(video);
                        }}
                      />
                    ) : null}

                    {contentType !== "photos" && contentType !== "videos" && groupedTimeline.undatedJournalEntries.length > 0 ? (
                      <JournalEntryList
                        entries={groupedTimeline.undatedJournalEntries}
                        expandedIds={expandedJournalEntryIds}
                        onToggleExpand={(entryId) => {
                          setExpandedJournalEntryIds((currentValue) => {
                            const nextValue = new Set(currentValue);

                            if (nextValue.has(entryId)) {
                              nextValue.delete(entryId);
                            } else {
                              nextValue.add(entryId);
                            }

                            return nextValue;
                          });
                        }}
                      />
                    ) : null}

                    {(contentType === "videos" && groupedTimeline.undatedVideos.length === 0)
                    || (contentType === "photos" && groupedTimeline.undatedPhotos.length === 0)
                    || (contentType === "journal" && groupedTimeline.undatedJournalEntries.length === 0)
                    || (contentType === "all"
                      && groupedTimeline.undatedPhotos.length === 0
                      && groupedTimeline.undatedVideos.length === 0
                      && groupedTimeline.undatedJournalEntries.length === 0) ? (
                        <p className="text-sm text-stone-500">No undated content.</p>
                      ) : null}
                  </div>
                </section>
              ) : null}

              {showNoContentDestinations && displayedDestinations.length === 0 ? (
                <section style={TIMELINE_SECTION_STYLE} className="border border-stone-300 bg-white px-5 py-8 text-sm text-stone-500">
                  No destinations are currently missing content.
                </section>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div
        className={
          hasActiveEditorContent
            ? "fixed inset-0 z-[60] flex min-h-0 flex-col bg-white pt-[env(safe-area-inset-top)] xl:static xl:z-auto xl:w-[560px] xl:shrink-0 xl:flex xl:pt-0"
            : "hidden min-h-0 xl:flex xl:w-[560px] xl:shrink-0"
        }
      >
        {isBulkEditing ? (
          <BulkActionBar
            selectedIds={selectedIds}
            people={people}
            allTags={tags}
            locationOptions={locationOptions}
            onAction={handleBulkAction}
            onClear={() => setSelectedIds(new Set())}
          />
        ) : editingVideo ? (
          <VideoEditor
            video={editingVideo}
            people={people}
            tags={tags}
            tagGroups={tagGroups}
            onClose={() => setEditingVideo(null)}
            onSaved={handleSavedVideo}
            onDeleted={handleDeletedVideo}
          />
        ) : (
          <PhotoEditor
            photo={editingPhoto}
            people={people}
            tags={tags}
            tagGroups={tagGroups}
            locationOptions={locationOptions}
            onClose={() => setEditingPhoto(null)}
            onSaved={handleSavedPhoto}
            onDeleted={handleDeletedPhoto}
            onNavigatePrevious={() => navigateEditingPhoto(-1)}
            onNavigateNext={() => navigateEditingPhoto(1)}
          />
        )}
      </div>
      </div>

      <AnalyzeQueueModal
        isOpen={isAnalyzeQueueOpen}
        photos={analyzeQueuePhotos}
        startPhotoId={analyzeQueueStartPhotoId}
        people={people}
        tags={tags}
        tagGroups={tagGroups}
        onClose={() => setIsAnalyzeQueueOpen(false)}
        onPhotoUpdated={handleSavedPhoto}
      />
    </>
  );
}

function isPhotoPendingAnalyze(photo) {
  if (!photo || photo.deleted_at) {
    return false;
  }

  if (!photo.large_url) {
    return false;
  }

  if (photo.processing_status === "queued" || photo.processing_status === "processing" || photo.processing_status === "failed") {
    return false;
  }

  if (!String(photo.title || "").trim()) {
    return true;
  }

  if (!String(photo.ai_caption || "").trim()) {
    return true;
  }

  if (!String(photo.alt_text || "").trim()) {
    return true;
  }

  return !Array.isArray(photo.tags) || photo.tags.length === 0;
}

function DestinationDropZone({ destination, isActive, isUploading, onDragEnter, onDragLeave, onDropFiles }) {
  const inputRef = useRef(null);

  function handleInputChange(event) {
    onDropFiles(event.target.files);
    event.target.value = "";
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      <button
        type="button"
        aria-label={`Add photos to ${destination.city}, ${destination.country}`}
        title={`Add photos to ${destination.city}, ${destination.country}`}
        onClick={() => {
          if (!isUploading) {
            inputRef.current?.click();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          onDragEnter();
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          onDragLeave();
        }}
        onDrop={(event) => {
          event.preventDefault();
          onDropFiles(event.dataTransfer?.files);
        }}
        className={`group relative overflow-hidden rounded-[1.75rem] border bg-stone-100 text-left transition ${
          isActive
            ? "border-amber-400 ring-2 ring-amber-300/80"
            : "border-stone-300 hover:border-stone-400"
        } ${isUploading ? "cursor-wait" : "cursor-pointer"}`}
      >
        <div className={`relative aspect-[4/3] overflow-hidden transition ${
          isActive ? "bg-amber-50" : "bg-stone-50"
        }`}>
          <div className="flex h-full w-full items-center justify-center text-stone-500 transition group-hover:text-stone-700">
            <span className="text-6xl leading-none">{isUploading ? "…" : "+"}</span>
          </div>
        </div>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.heic,.heif,.webp,image/jpeg,image/png,image/heic,image/heif,image/webp"
        multiple
        className="hidden"
        onChange={handleInputChange}
        onClick={(event) => {
          event.stopPropagation();
        }}
      />
    </div>
  );
}

function VideoGrid({ videos, onVideoClick }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {videos.map((video) => (
        <article
          key={video.id}
          style={TIMELINE_CARD_STYLE}
          className="group relative overflow-hidden rounded-[1.75rem] border border-stone-300 bg-stone-100 transition hover:border-stone-400"
        >
          <button type="button" onClick={() => onVideoClick(video)} className="block w-full text-left">
            <div className="relative aspect-video overflow-hidden bg-stone-200">
              {video.thumbnail_url ? (
                <img
                  src={video.thumbnail_url}
                  alt={video.title || "Video thumbnail"}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-stone-500">No thumbnail</div>
              )}

              <div className="absolute bottom-2 right-2 rounded-full bg-stone-950/80 px-2 py-1 text-xs font-medium text-white">
                {formatVideoDuration(video.duration_seconds)}
              </div>
            </div>

            <div className="space-y-2 px-3 py-3">
              <h3 className="line-clamp-2 text-sm font-medium leading-5 text-stone-900">
                {video.title || "Untitled video"}
              </h3>
            </div>
          </button>
        </article>
      ))}
    </div>
  );
}

function JournalEntryList({ entries, expandedIds, onToggleExpand }) {
  return (
    <div className="space-y-3">
      {entries.map((entry) => {
        const isExpanded = expandedIds.has(entry.id);
        const hasBody = Boolean(String(entry.text || "").trim());
        const metaLine = [
          entry.city || null,
          entry.weather_description || entry.weather_conditions || null,
          entry.temperature_celsius !== null && entry.temperature_celsius !== undefined
            ? `${Math.round(Number(entry.temperature_celsius))}°C`
            : null
        ].filter(Boolean).join(" · ");

        return (
          <article key={entry.id} style={TIMELINE_CARD_STYLE} className="border border-stone-300 bg-stone-50 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="text-xl leading-none">📓</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="min-w-0 break-words text-base font-semibold text-stone-900">
                    {entry.title || "Untitled journal entry"}
                  </h3>
                  <p className="text-sm text-stone-500">{formatJournalDate(entry.entry_date)}</p>
                </div>

                {metaLine ? (
                  <p className="mt-1 text-sm text-stone-500">{metaLine}</p>
                ) : null}

                {hasBody ? (
                  <div className="mt-3">
                    <p className={`whitespace-pre-wrap text-sm leading-6 text-stone-700 ${isExpanded ? "" : "line-clamp-3"}`}>
                      {entry.text}
                    </p>
                    {entry.text.length > 160 ? (
                      <button
                        type="button"
                        onClick={() => onToggleExpand(entry.id)}
                        className="mt-2 text-sm font-medium text-stone-700 underline underline-offset-2"
                      >
                        {isExpanded ? "Read less" : "Read more"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function buildUniqueLocationOptions(items, field) {
  return [...new Set(
    items
      .map((item) => String(item?.[field] || "").trim())
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right));
}

function findMatchingDestinationForPhoto(photo, destinations) {
  if (!photo.captured_at) {
    return null;
  }

  const photoTime = new Date(photo.captured_at).getTime();

  if (Number.isNaN(photoTime)) {
    return null;
  }

  return matchDestinationByLocationAndDate({
    city: photo.city,
    country: photo.country,
    timestamp: photoTime
  }, destinations);
}

function findMatchingDestinationForVideo(video, destinations) {
  if (video.video_category && video.video_category !== "travel") {
    return null;
  }

  const filmedTime = getTimestamp(video.date_filmed);

  if (filmedTime !== null) {
    const filmedMatch = matchDestinationByLocationAndDate({
      city: video.filmed_city,
      country: video.filmed_country,
      timestamp: filmedTime
    }, destinations);

    if (filmedMatch) {
      return filmedMatch;
    }
  }

  const publishedTime = getTimestamp(video.date_published);

  if (publishedTime !== null) {
    return matchDestinationByLocationAndDate({
      city: video.filmed_city,
      country: video.filmed_country,
      timestamp: publishedTime
    }, destinations);
  }

  return null;
}

function findMatchingDestinationForJournalEntry(entry, destinations) {
  const timestamp = getJournalTimestamp(entry);

  if (timestamp === null) {
    return null;
  }

  const dateMatches = destinations.filter((destination) => isWithinDateRange(timestamp, destination));

  if (dateMatches.length > 0) {
    return sortDestinationsByContainedThenStart(dateMatches, timestamp)[0];
  }

  return null;
}

function sortJournalEntriesForDisplay(entries, sortDirection) {
  const sorted = [...entries];

  sorted.sort((left, right) => {
    const leftTime = getJournalTimestamp(left) ?? 0;
    const rightTime = getJournalTimestamp(right) ?? 0;

    if (sortDirection === "oldest") {
      return leftTime - rightTime || left.id - right.id;
    }

    return rightTime - leftTime || right.id - left.id;
  });

  return sorted;
}

function getTimestamp(value) {
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isNaN(timestamp) ? null : timestamp;
}

function matchDestinationByLocationAndDate({ city, country, timestamp }, destinations) {
  if (timestamp === null) {
    return null;
  }

  const normalizedCity = String(city || "").trim().toLowerCase();
  const normalizedCountry = String(country || "").trim().toLowerCase();

  if (normalizedCity) {
    const cityMatches = destinations
      .filter((destination) => String(destination.city || "").trim().toLowerCase() === normalizedCity)
      .filter((destination) => isWithinDateWindow(timestamp, destination, 3));

    if (cityMatches.length > 0) {
      return sortDestinationsByContainedThenStart(cityMatches, timestamp)[0];
    }
  }

  if (normalizedCountry) {
    const countryMatches = destinations
      .filter((destination) => String(destination.country || "").trim().toLowerCase() === normalizedCountry)
      .filter((destination) => isWithinDateRange(timestamp, destination));

    if (countryMatches.length > 0) {
      return sortDestinationsByContainedThenStart(countryMatches, timestamp)[0];
    }
  }

  const dateMatches = destinations.filter((destination) => isWithinDateRange(timestamp, destination));

  if (dateMatches.length > 0) {
    return sortDestinationsByContainedThenStart(dateMatches, timestamp)[0];
  }

  return null;
}

function isWithinDateWindow(itemTime, destination, toleranceDays) {
  const startTime = new Date(destination.date_start).getTime();
  const endTime = new Date(destination.date_end).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return false;
  }

  const toleranceMs = toleranceDays * 24 * 60 * 60 * 1000;
  return itemTime >= startTime - toleranceMs && itemTime < endTime + toleranceMs;
}

function isWithinDateRange(itemTime, destination) {
  const startTime = new Date(destination.date_start).getTime();
  const endTime = new Date(destination.date_end).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return false;
  }

  return itemTime >= startTime && itemTime < endTime;
}

function sortDestinationsByContainedThenStart(destinations, itemTime) {
  return [...destinations].sort((left, right) => {
    const leftContains = isWithinDateRange(itemTime, left);
    const rightContains = isWithinDateRange(itemTime, right);

    if (leftContains !== rightContains) {
      return leftContains ? -1 : 1;
    }

    return new Date(left.date_start).getTime() - new Date(right.date_start).getTime();
  });
}
