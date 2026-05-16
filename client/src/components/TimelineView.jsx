import { useEffect, useMemo, useRef, useState } from "react";
import { getDestinations, getPhotos, getVideos, updatePhoto, uploadPhotos } from "../api";
import BulkActionBar from "./BulkActionBar";
import PhotoEditor from "./PhotoEditor";
import PhotoFilters from "./PhotoFilters";
import PhotoGrid from "./PhotoGrid";
import VideoEditor from "./VideoEditor";

const CONTENT_TYPE_OPTIONS = [
  { id: "all", label: "All", disabled: false },
  { id: "photos", label: "Photos", disabled: false },
  { id: "videos", label: "Videos", disabled: false }
];

function formatMonthRange(dateStart, dateEnd) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  return `${formatter.format(new Date(dateStart))} – ${formatter.format(new Date(dateEnd))}`;
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

export default function TimelineView({ people, tags, tagGroups }) {
  const [destinations, setDestinations] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [videos, setVideos] = useState([]);
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
  const contentScrollRef = useRef(null);

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
        const [destinationsResponse, photosResponse, videosResponse] = await Promise.all([
          getDestinations(),
          getPhotos(filters),
          getVideos()
        ]);

        if (!isActive) {
          return;
        }

        setDestinations(destinationsResponse?.data || []);
        syncLoadedPhotos(photosResponse?.data || [], { resetSelection: true });
        syncLoadedVideos(videosResponse?.data || []);
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
    const undatedPhotos = [];
    const undatedVideos = [];
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

    const destinationBlocks = [...destinations]
      .sort((left, right) => {
        const comparison = new Date(left.date_start).getTime() - new Date(right.date_start).getTime();
        return sortDirection === "oldest" ? comparison : -comparison;
      })
      .map((destination) => ({
        ...destination,
        photos: sortPhotosForDisplay(photosByDestinationId.get(destination.id) || [], sortDirection),
        videos: sortVideosForDisplay(videosByDestinationId.get(destination.id) || [], sortDirection)
      }));

    return {
      destinations: destinationBlocks,
      undatedPhotos: sortPhotosForDisplay(undatedPhotos, sortDirection),
      undatedVideos: sortVideosForDisplay(undatedVideos, sortDirection),
      brandedVideos: sortVideosForDisplay(brandedVideos, sortDirection)
    };
  }, [destinations, photos, videos, sortDirection]);

  const activeMissingFilters = useMemo(() => parseCsvList(filters.missing), [filters.missing]);
  const showNoContentDestinations = activeMissingFilters.includes("no_content");

  const displayedDestinations = useMemo(() => {
    if (!showNoContentDestinations) {
      return groupedTimeline.destinations;
    }

    return groupedTimeline.destinations.filter((destination) => (
      destination.photos.length === 0 && destination.videos.length === 0
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

  function handleSavedPhoto(updatedPhoto) {
    setPhotos((currentPhotos) => currentPhotos.map((currentPhoto) => (
      currentPhoto.id === updatedPhoto.id ? updatedPhoto : currentPhoto
    )));
    setEditingPhoto(updatedPhoto);
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

  return (
    <div className="relative flex min-h-0 flex-1 gap-6 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <PhotoFilters
          people={people}
          tags={tags}
          locationOptions={locationOptions}
          onApply={handleApplyFilters}
          onClear={handleClearFilters}
        />

        <section className="panel mb-4 px-5 py-4">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.24em] text-stone-500">Sort</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSortDirection("newest")}
                    className={sortDirection === "newest" ? "btn-primary" : "btn-secondary"}
                  >
                    Newest First
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortDirection("oldest")}
                    className={sortDirection === "oldest" ? "btn-primary" : "btn-secondary"}
                  >
                    Oldest First
                  </button>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.24em] text-stone-500">Content</p>
                <div className="flex gap-2">
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
                      className={
                        option.disabled
                          ? "btn-secondary opacity-50"
                          : contentType === option.id
                            ? "btn-primary"
                            : "btn-secondary"
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

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

            {contentType === "videos" ? (
              <div className="flex min-h-[240px] items-center justify-center border border-dashed border-stone-300 bg-stone-50 px-6 py-10 text-sm text-stone-500">
                Video results do not use the photo filters.
              </div>
            ) : (
              <div ref={contentScrollRef} className="min-h-0 flex-1 overflow-y-auto">
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
          <div ref={contentScrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-8 pb-4">
              {displayedDestinations.map((destination) => {
                const visiblePhotos = contentType === "videos" ? [] : destination.photos;
                const visibleVideos = contentType === "photos" ? [] : destination.videos;
                const hasVisibleContent = visiblePhotos.length > 0 || visibleVideos.length > 0;

                return (
                  <section key={destination.id} className="border border-stone-300 bg-white">
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

                      {!hasVisibleContent && contentType !== "videos" ? (
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

              {contentType !== "photos" && groupedTimeline.brandedVideos.length > 0 ? (
                <section className="border border-stone-300 bg-white">
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
                <section className="border border-stone-300 bg-white">
                  <div className="border-b border-stone-200 px-5 py-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Undated</p>
                    <h2 className="mt-2 text-2xl font-semibold text-stone-900">Undated Content</h2>
                    <p className="mt-2 text-sm text-stone-500">
                      {groupedTimeline.undatedPhotos.length} photo{groupedTimeline.undatedPhotos.length === 1 ? "" : "s"}
                      {" · "}
                      {groupedTimeline.undatedVideos.length} video{groupedTimeline.undatedVideos.length === 1 ? "" : "s"}
                    </p>
                  </div>

                  <div className="space-y-5 px-5 py-5">
                    {contentType !== "videos" && groupedTimeline.undatedPhotos.length > 0 ? (
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

                    {contentType !== "photos" && groupedTimeline.undatedVideos.length > 0 ? (
                      <VideoGrid
                        videos={groupedTimeline.undatedVideos}
                        onVideoClick={(video) => {
                          setEditingPhoto(null);
                          setEditingVideo(video);
                        }}
                      />
                    ) : null}

                    {(contentType === "videos" && groupedTimeline.undatedVideos.length === 0)
                    || (contentType === "photos" && groupedTimeline.undatedPhotos.length === 0)
                    || (contentType === "all"
                      && groupedTimeline.undatedPhotos.length === 0
                      && groupedTimeline.undatedVideos.length === 0) ? (
                        <p className="text-sm text-stone-500">No undated content.</p>
                      ) : null}
                  </div>
                </section>
              ) : null}

              {showNoContentDestinations && displayedDestinations.length === 0 ? (
                <section className="border border-stone-300 bg-white px-5 py-8 text-sm text-stone-500">
                  No destinations are currently missing content.
                </section>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div className="hidden min-h-0 w-[560px] shrink-0 xl:flex">
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
          className="group relative overflow-hidden rounded-[1.75rem] border border-stone-300 bg-stone-100 transition hover:border-stone-400"
        >
          <button type="button" onClick={() => onVideoClick(video)} className="block w-full text-left">
            <div className="relative aspect-video overflow-hidden bg-stone-200">
              {video.thumbnail_url ? (
                <img
                  src={video.thumbnail_url}
                  alt={video.title || "Video thumbnail"}
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
