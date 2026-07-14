import { useEffect, useMemo, useRef, useState } from "react";
import {
  deletePhoto,
  getDestinations,
  getJournalEntries,
  getPhotos,
  getVideos,
  restorePhoto,
  updatePhoto,
  uploadPhotos
} from "../api";
import AnalyzeQueueModal from "./AnalyzeQueueModal";
import BulkActionBar, {
  AddPersonAction,
  AddTagAction,
  AssignDestinationAction,
  RemovePersonAction,
  RemoveTagAction
} from "./BulkActionBar";
import PhotoEditor from "./PhotoEditor";
import PhotoFilters from "./PhotoFilters";
import PhotoGrid from "./PhotoGrid";
import VideoEditor from "./VideoEditor";

const CONTENT_TYPE_OPTIONS = [
  { id: "all", label: "All", disabled: false },
  { id: "photos", label: "Photos", disabled: false },
  { id: "videos", label: "Videos", disabled: false },
  { id: "journal", label: "Journal", disabled: false },
  { id: "trash", label: "Recently Deleted", shortLabel: "Deleted", disabled: false }
];

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

function formatArrivalMonth(value) {
  if (!value) {
    return "Unknown month";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Unknown month";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric"
  }).format(parsed);
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

export default function TimelineView({ people, tags, tagGroups, onDesktopSidebarChange }) {
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
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [activeFilterCount, setActiveFilterCount] = useState(0);
  const [activeBulkSheet, setActiveBulkSheet] = useState(null);
  const [bulkSheetOffsetY, setBulkSheetOffsetY] = useState(0);
  const [isDeleteSubmitting, setIsDeleteSubmitting] = useState(false);
  const [restoringPhotoId, setRestoringPhotoId] = useState(null);
  const [activeDestinationId, setActiveDestinationId] = useState(null);
  const [deleteError, setDeleteError] = useState("");
  const [destinationActionKey, setDestinationActionKey] = useState(0);
  const contentScrollRef = useRef(null);
  const destinationSectionRefs = useRef(new Map());
  const sidebarSyncFrameRef = useRef(null);
  const selectionAnchorRef = useRef(null);
  const filterSheetStartYRef = useRef(0);
  const filterSheetCanDragRef = useRef(false);
  const filterSheetScrollRef = useRef(null);
  const [filterSheetOffsetY, setFilterSheetOffsetY] = useState(0);
  const bulkSheetStartYRef = useRef(0);
  const bulkSheetCanDragRef = useRef(false);
  const bulkSheetScrollRef = useRef(null);

  function syncLoadedPhotos(nextPhotos, { resetSelection = false } = {}) {
    setPhotos(nextPhotos);

    if (resetSelection) {
      setSelectedIds(new Set());
      selectionAnchorRef.current = null;
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
          getPhotos(buildPhotoRequestFilters(filters, contentType)),
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
  }, [contentType, filters, refreshNonce]);

  const visibleTimelinePhotos = useMemo(() => {
    if (contentType === "trash") {
      return photos.filter((photo) => photo.deleted_at);
    }

    return photos.filter((photo) => !photo.deleted_at);
  }, [contentType, photos]);

  const hasPendingPhotoProcessing = visibleTimelinePhotos.some((photo) => (
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
        const photosResponse = await getPhotos(buildPhotoRequestFilters(filters, contentType));

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
  }, [contentType, filters, hasPendingPhotoProcessing]);

  const groupedTimeline = useMemo(() => {
    const photosByDestinationId = new Map(destinations.map((destination) => [destination.id, []]));
    const videosByDestinationId = new Map(destinations.map((destination) => [destination.id, []]));
    const journalEntriesByDestinationId = new Map(destinations.map((destination) => [destination.id, []]));
    const undatedPhotos = [];
    const undatedVideos = [];
    const undatedJournalEntries = [];
    const brandedVideos = [];

    for (const photo of visibleTimelinePhotos) {
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
  }, [destinations, journalEntries, sortDirection, videos, visibleTimelinePhotos]);

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

  const desktopSidebarItems = useMemo(() => displayedDestinations.map((destination) => ({
    id: destination.id,
    label: `${destination.city}, ${destination.country}`,
    meta: formatArrivalMonth(destination.date_start)
  })), [displayedDestinations]);

  const locationOptions = useMemo(() => ({
    neighborhoods: buildUniqueLocationOptions(visibleTimelinePhotos, "neighborhood"),
    cities: buildUniqueLocationOptions([
      ...visibleTimelinePhotos.map((photo) => ({ city: photo.city })),
      ...videos.map((video) => ({ city: video.filmed_city }))
    ], "city"),
    regions: buildUniqueLocationOptions(visibleTimelinePhotos, "region"),
    countries: buildUniqueLocationOptions([
      ...visibleTimelinePhotos.map((photo) => ({ country: photo.country })),
      ...videos.map((video) => ({ country: video.filmed_country }))
    ], "country")
  }), [videos, visibleTimelinePhotos]);
  const isBulkEditing = selectedIds.size > 1;
  const isDesktopBulkEditing = !isMobile && isBulkEditing;
  const hasMobileOverlayEditor = contentType !== "trash" && (Boolean(editingVideo) || Boolean(editingPhoto));
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

  function setDestinationSectionRef(destinationId, element) {
    if (!destinationId) {
      return;
    }

    if (element) {
      destinationSectionRefs.current.set(destinationId, element);
      return;
    }

    destinationSectionRefs.current.delete(destinationId);
  }

  function scrollToDestination(destinationId) {
    const container = contentScrollRef.current;
    const section = destinationSectionRefs.current.get(destinationId);

    if (!container || !section) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const nextTop = sectionRect.top - containerRect.top + container.scrollTop - 12;

    container.scrollTo({
      top: Math.max(0, nextTop),
      behavior: "smooth"
    });

    setActiveDestinationId(destinationId);
  }

  useEffect(() => {
    if (selectedIds.size === 0) {
      setActiveBulkSheet(null);
      setBulkSheetOffsetY(0);
      setDeleteError("");
      selectionAnchorRef.current = null;
    }
  }, [selectedIds.size]);

  useEffect(() => {
    setSelectedIds(new Set());
    selectionAnchorRef.current = null;
    setActiveBulkSheet(null);

    if (contentType === "trash") {
      setEditingPhoto(null);
      setEditingVideo(null);
    }
  }, [contentType]);

  useEffect(() => () => {
    if (sidebarSyncFrameRef.current) {
      window.cancelAnimationFrame(sidebarSyncFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (isMobile || contentType === "trash" || (hasActiveFilters && !showNoContentDestinations)) {
      setActiveDestinationId(null);
      return;
    }

    const firstDestinationId = displayedDestinations[0]?.id || null;
    setActiveDestinationId((currentValue) => (
      displayedDestinations.some((destination) => destination.id === currentValue)
        ? currentValue
        : firstDestinationId
    ));
  }, [contentType, displayedDestinations, hasActiveFilters, isMobile, showNoContentDestinations]);

  useEffect(() => {
    if (isMobile) {
      onDesktopSidebarChange?.({
        items: [],
        activeId: null,
        onSelect: null,
        emptyMessage: "Trips are available on desktop."
      });
      return undefined;
    }

    if (contentType === "trash") {
      onDesktopSidebarChange?.({
        items: [],
        activeId: null,
        onSelect: null,
        emptyMessage: "Recently deleted photos do not belong to a trip list."
      });
      return undefined;
    }

    if (hasActiveFilters && !showNoContentDestinations) {
      onDesktopSidebarChange?.({
        items: [],
        activeId: null,
        onSelect: null,
        emptyMessage: "Clear photo filters to navigate trips from the sidebar."
      });
      return undefined;
    }

    onDesktopSidebarChange?.({
      items: desktopSidebarItems,
      activeId: activeDestinationId,
      onSelect: scrollToDestination,
      emptyMessage: showNoContentDestinations
        ? "No matching destinations are visible right now."
        : "Trips will appear here."
    });

    return () => {
      onDesktopSidebarChange?.({
        items: [],
        activeId: null,
        onSelect: null,
        emptyMessage: "Trips will appear here."
      });
    };
  }, [
    activeDestinationId,
    contentType,
    desktopSidebarItems,
    hasActiveFilters,
    isMobile,
    onDesktopSidebarChange,
    showNoContentDestinations
  ]);

  useEffect(() => {
    if (isMobile || contentType === "trash" || (hasActiveFilters && !showNoContentDestinations)) {
      return undefined;
    }

    const container = contentScrollRef.current;

    if (!container) {
      return undefined;
    }

    function updateActiveDestination() {
      const containerRect = container.getBoundingClientRect();
      const candidates = displayedDestinations
        .map((destination) => {
          const element = destinationSectionRefs.current.get(destination.id);

          if (!element) {
            return null;
          }

          const rect = element.getBoundingClientRect();
          return {
            id: destination.id,
            top: rect.top - containerRect.top,
            distance: Math.abs(rect.top - containerRect.top - 96)
          };
        })
        .filter(Boolean);

      if (candidates.length === 0) {
        return;
      }

      const passedDestinations = candidates.filter((candidate) => candidate.top <= 96);
      const nextActive = passedDestinations.length > 0
        ? passedDestinations.reduce((best, candidate) => (
            candidate.top > best.top ? candidate : best
          ))
        : candidates.reduce((best, candidate) => (
            candidate.distance < best.distance ? candidate : best
          ));

      setActiveDestinationId(nextActive.id);
    }

    function handleScroll() {
      if (sidebarSyncFrameRef.current) {
        window.cancelAnimationFrame(sidebarSyncFrameRef.current);
      }

      sidebarSyncFrameRef.current = window.requestAnimationFrame(() => {
        updateActiveDestination();
        sidebarSyncFrameRef.current = null;
      });
    }

    updateActiveDestination();
    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);

    return () => {
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (sidebarSyncFrameRef.current) {
        window.cancelAnimationFrame(sidebarSyncFrameRef.current);
        sidebarSyncFrameRef.current = null;
      }
    };
  }, [
    contentType,
    displayedDestinations,
    hasActiveFilters,
    isMobile,
    showNoContentDestinations
  ]);

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
    const photosResponse = await getPhotos(buildPhotoRequestFilters(filters, contentType));
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

  async function handleRestorePhoto(photoId) {
    if (!photoId || restoringPhotoId) {
      return;
    }

    setRestoringPhotoId(photoId);
    setError("");

    try {
      await restorePhoto(photoId);
      await refreshPhotosPreservingView({ resetSelection: true });
    } catch (restoreError) {
      setError(restoreError.message || "Failed to restore photo");
    } finally {
      setRestoringPhotoId(null);
    }
  }

  async function handleDeleteSelection() {
    const ids = [...selectedIds];

    if (ids.length === 0 || isDeleteSubmitting) {
      return;
    }

    setIsDeleteSubmitting(true);
    setDeleteError("");

    try {
      await Promise.all(ids.map((photoId) => deletePhoto(photoId)));
      setSelectedIds(new Set());
      setActiveBulkSheet(null);
      await handleBulkAction();
    } catch (deleteActionError) {
      setDeleteError(deleteActionError.message || "Failed to delete photos");
    } finally {
      setIsDeleteSubmitting(false);
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

  const filteredPhotos = useMemo(
    () => sortPhotosForDisplay(visibleTimelinePhotos, sortDirection),
    [sortDirection, visibleTimelinePhotos]
  );
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
    return visiblePhotosInOrder.filter((photo) => isPhotoPendingAnalyze(photo));
  }, [visiblePhotosInOrder]);
  const analyzeQueueStartPhotoId = useMemo(() => {
    const selectedPhotoId = editingPhoto?.id || null;

    if (selectedPhotoId && analyzeQueuePhotos.some((photo) => photo.id === selectedPhotoId)) {
      return selectedPhotoId;
    }

    return null;
  }, [analyzeQueuePhotos, editingPhoto?.id]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== "Escape" || selectedIds.size === 0) {
        return;
      }

      setSelectedIds(new Set());
      selectionAnchorRef.current = null;
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedIds.size]);

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

  function closeBulkSheet() {
    setActiveBulkSheet(null);
    setBulkSheetOffsetY(0);
    setDeleteError("");
    setDestinationActionKey((currentValue) => currentValue + 1);
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

  function handleBulkSheetTouchStart(event) {
    if (!isMobile || !activeBulkSheet) {
      return;
    }

    bulkSheetCanDragRef.current = (bulkSheetScrollRef.current?.scrollTop || 0) <= 0;
    bulkSheetStartYRef.current = event.touches[0]?.clientY || 0;
  }

  function handleBulkSheetTouchMove(event) {
    if (!isMobile || !activeBulkSheet) {
      return;
    }

    const currentY = event.touches[0]?.clientY || 0;
    const nextOffset = Math.max(0, currentY - bulkSheetStartYRef.current);

    if (!bulkSheetCanDragRef.current || nextOffset === 0) {
      return;
    }

    setBulkSheetOffsetY(nextOffset);
  }

  function handleBulkSheetTouchEnd() {
    if (!isMobile || !activeBulkSheet) {
      return;
    }

    bulkSheetCanDragRef.current = false;

    if (bulkSheetOffsetY > 80) {
      closeBulkSheet();
      return;
    }

    setBulkSheetOffsetY(0);
  }

  function renderBulkSheetBody() {
    if (activeBulkSheet === "destination") {
      return (
        <AssignDestinationAction
          key={destinationActionKey}
          selectedIds={selectedIds}
          onDone={handleBulkAction}
          onClearSelection={() => setSelectedIds(new Set())}
          onClose={closeBulkSheet}
          inline
          stickyConfirm
        />
      );
    }

    if (activeBulkSheet === "delete") {
      return (
        <div className="space-y-4">
          <p className="text-sm text-stone-600">
            Delete {selectedIds.size} photo{selectedIds.size === 1 ? "" : "s"}? They will be moved to trash and can be
            restored.
          </p>
          {deleteError ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{deleteError}</div> : null}
        </div>
      );
    }

    if (activeBulkSheet === "people") {
      return (
        <div className="space-y-6">
          <div>
            <p className="mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">Add Person</p>
            <AddPersonAction
              selectedIds={selectedIds}
              people={people}
              onDone={handleBulkAction}
              onClearSelection={() => setSelectedIds(new Set())}
              inline
            />
          </div>
          <div className="border-t border-stone-200 pt-5">
            <p className="mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">Remove Person</p>
            <RemovePersonAction
              selectedIds={selectedIds}
              people={people}
              onDone={handleBulkAction}
              onClearSelection={() => setSelectedIds(new Set())}
              inline
            />
          </div>
        </div>
      );
    }

    if (activeBulkSheet === "tags") {
      return (
        <div className="space-y-6">
          <div>
            <p className="mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">Add Tag</p>
            <AddTagAction
              selectedIds={selectedIds}
              onDone={handleBulkAction}
              onClearSelection={() => setSelectedIds(new Set())}
              inline
            />
          </div>
          <div className="border-t border-stone-200 pt-5">
            <p className="mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">Remove Tag</p>
            <RemoveTagAction
              selectedIds={selectedIds}
              allTags={tags}
              onDone={handleBulkAction}
              onClearSelection={() => setSelectedIds(new Set())}
              inline
            />
          </div>
        </div>
      );
    }

    return null;
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
                disabled={contentType === "videos" || contentType === "journal" || contentType === "trash" || analyzeQueuePhotos.length === 0}
                className={contentType === "videos" || contentType === "journal" || contentType === "trash" || analyzeQueuePhotos.length === 0 ? "btn-secondary gap-3 opacity-50" : "ai-button"}
              >
                <i className="ti ti-sparkles text-base" aria-hidden="true" />
                <span>Analyze Queue</span>
                <span
                  className={
                    contentType === "videos" || contentType === "journal" || contentType === "trash" || analyzeQueuePhotos.length === 0
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
                  {option.shortLabel || option.label}
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

        {isLoading ? (
          <section className="panel flex min-h-[360px] items-center justify-center p-8">
            <div className="text-center">
              <p className="text-sm font-medium text-stone-700">Loading timeline...</p>
              <p className="mt-2 text-sm text-stone-500">Fetching destinations, photos, and videos.</p>
              <p className="mt-1 text-sm text-stone-500">Loading journal entries too.</p>
            </div>
          </section>
        ) : contentType === "trash" ? (
          <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden p-6">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Recently Deleted</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-900">
                  {filteredPhotos.length} deleted photo{filteredPhotos.length === 1 ? "" : "s"}
                </h2>
                <p className="mt-2 text-sm text-stone-500">
                  Restoring a photo returns it to the main timeline.
                </p>
              </div>

              {hasActiveFilters ? (
                <button type="button" onClick={handleClearFilters} className="btn-secondary">
                  Clear Filters
                </button>
              ) : null}
            </div>

            <div ref={contentScrollRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
              <RecentlyDeletedGrid
                photos={filteredPhotos}
                restoringPhotoId={restoringPhotoId}
                onRestore={handleRestorePhoto}
              />
            </div>
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
                  selectionAnchorRef={selectionAnchorRef}
                  visiblePhotoIds={visiblePhotosInOrder.map((photo) => photo.id)}
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
                  <section
                    key={destination.id}
                    ref={(element) => setDestinationSectionRef(destination.id, element)}
                    style={TIMELINE_SECTION_STYLE}
                    className="border border-stone-300 bg-white"
                  >
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
                          selectionAnchorRef={selectionAnchorRef}
                          visiblePhotoIds={visiblePhotosInOrder.map((photo) => photo.id)}
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
                        selectionAnchorRef={selectionAnchorRef}
                        visiblePhotoIds={visiblePhotosInOrder.map((photo) => photo.id)}
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

      {selectedIds.size >= 1 ? (
        <div className="fixed inset-x-0 bottom-0 z-[70] border-t border-stone-300 bg-stone-50/95 px-3 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur xl:hidden">
          <div className="flex items-center gap-2">
            <div className="min-w-0 px-2">
              <p className="text-[10px] uppercase tracking-[0.22em] text-stone-500">Selected</p>
              <p className="text-sm font-medium text-stone-900">
                {selectedIds.size} selected
              </p>
            </div>

            {[
              { id: "destination", label: "Destination", icon: "ti ti-map-pin" },
              { id: "delete", label: "Delete", icon: "ti ti-trash" },
              { id: "people", label: "People", icon: "ti ti-user" },
              { id: "tags", label: "Tags", icon: "ti ti-tag" }
            ].map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => {
                  setDeleteError("");
                  setActiveBulkSheet(action.id);
                }}
                className="flex min-h-[56px] flex-1 flex-col items-center justify-center rounded-2xl px-2 py-2 text-center text-[11px] font-medium text-stone-700 transition hover:bg-white hover:text-stone-900"
              >
                <i className={`${action.icon} text-base`} aria-hidden="true" />
                <span className="mt-1">{action.label}</span>
              </button>
            ))}

            <button
              type="button"
              onClick={() => {
                setSelectedIds(new Set());
                selectionAnchorRef.current = null;
              }}
              className="flex min-h-[56px] w-14 shrink-0 flex-col items-center justify-center rounded-2xl px-2 py-2 text-center text-[11px] font-medium text-stone-700 transition hover:bg-white hover:text-stone-900"
            >
              <i className="ti ti-x text-base" aria-hidden="true" />
              <span className="mt-1">Clear</span>
            </button>
          </div>
        </div>
      ) : null}

      {activeBulkSheet ? (
        <>
          <div
            className="fixed inset-0 z-[75] bg-stone-950/35 transition xl:hidden"
            onClick={closeBulkSheet}
          />
          <div
            className="fixed inset-x-0 bottom-0 z-[80] rounded-t-[1.75rem] border border-stone-300 bg-white xl:hidden"
            onTouchStart={handleBulkSheetTouchStart}
            onTouchMove={handleBulkSheetTouchMove}
            onTouchEnd={handleBulkSheetTouchEnd}
            style={{
              transform: `translateY(${bulkSheetOffsetY}px)`,
              transition: bulkSheetOffsetY > 0 ? "none" : "transform 180ms ease-out"
            }}
          >
            <div ref={bulkSheetScrollRef} className="max-h-[85vh] overflow-y-auto">
              <div className="sticky top-0 z-10 border-b border-stone-200 bg-white px-5 pb-4 pt-3">
                <div className="mx-auto h-1.5 w-12 rounded-full bg-stone-300" />
                <div className="mt-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Bulk Action</p>
                    <h3 className="mt-1 text-lg font-semibold text-stone-900">
                      {activeBulkSheet === "destination"
                        ? "Assign Destination"
                        : activeBulkSheet === "delete"
                          ? "Delete"
                          : activeBulkSheet === "people"
                            ? "People"
                            : "Tags"}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={closeBulkSheet}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-700"
                    aria-label="Close bulk action"
                  >
                    <i className="ti ti-x text-base" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="space-y-5 px-5 py-5">
                {renderBulkSheetBody()}
              </div>

              {activeBulkSheet === "delete" ? (
                <div className="sticky bottom-0 border-t border-stone-200 bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4">
                  <div className="flex gap-3">
                    <button type="button" onClick={closeBulkSheet} className="btn-secondary flex-1">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteSelection}
                      disabled={isDeleteSubmitting}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <i className="ti ti-trash text-base" aria-hidden="true" />
                      {isDeleteSubmitting ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {contentType !== "trash" ? (
      <div
        className={
          hasMobileOverlayEditor
            ? "fixed inset-0 z-[60] flex min-h-0 flex-col bg-white pt-[env(safe-area-inset-top)] xl:static xl:z-auto xl:w-[560px] xl:shrink-0 xl:flex xl:pt-0"
            : "hidden min-h-0 xl:flex xl:w-[560px] xl:shrink-0"
        }
      >
        {isDesktopBulkEditing ? (
          <BulkActionBar
            selectedIds={selectedIds}
            people={people}
            allTags={tags}
            locationOptions={locationOptions}
            onAction={handleBulkAction}
            onClear={() => {
              setSelectedIds(new Set());
              selectionAnchorRef.current = null;
            }}
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
      ) : null}
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

function buildPhotoRequestFilters(filters, contentType) {
  if (contentType === "trash") {
    return {
      ...filters,
      include_deleted: true
    };
  }

  return filters;
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

function formatDeletedTimestamp(value) {
  if (!value) {
    return "Deleted recently";
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "Deleted recently";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function RecentlyDeletedGrid({ photos, restoringPhotoId, onRestore }) {
  if (photos.length === 0) {
    return (
      <div className="rounded-[2rem] border border-dashed border-stone-300 bg-stone-50 px-8 py-16 text-center">
        <p className="text-lg font-medium text-stone-700">No deleted photos right now.</p>
        <p className="mt-3 text-sm text-stone-500">
          Photos you delete from the timeline will show up here until you restore them.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {photos.map((photo) => {
        const isRestoring = restoringPhotoId === photo.id;

        return (
          <article
            key={photo.id}
            style={TIMELINE_CARD_STYLE}
            className="overflow-hidden rounded-[1.75rem] border border-stone-300 bg-white"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-stone-200">
              {photo.thumbnail_url ? (
                <img
                  src={photo.thumbnail_url}
                  alt={photo.alt_text || photo.original_filename || "Deleted photo thumbnail"}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-stone-200 text-sm text-stone-500">
                  No thumbnail
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-stone-950/70 via-transparent to-transparent" />
              <div className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-stone-950/70 px-3 py-1 text-xs font-medium text-white">
                <i className="ti ti-trash text-sm" aria-hidden="true" />
                Deleted
              </div>
              <div className="absolute inset-x-0 bottom-0 px-4 py-3 text-white">
                <p className="truncate text-sm font-medium">{photo.original_filename || "Untitled photo"}</p>
                <p className="mt-1 text-xs text-white/80">{formatDeletedTimestamp(photo.deleted_at)}</p>
              </div>
            </div>

            <div className="space-y-3 px-4 py-4">
              <div className="min-h-[2.5rem]">
                <p className="line-clamp-2 text-sm text-stone-600">
                  {[photo.city, photo.country].filter(Boolean).join(", ") || "No location saved"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRestore(photo.id)}
                disabled={Boolean(restoringPhotoId)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <i className="ti ti-restore text-base" aria-hidden="true" />
                <span>{isRestoring ? "Restoring..." : "Restore"}</span>
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
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
