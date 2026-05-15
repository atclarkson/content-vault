import { useEffect, useMemo, useRef, useState } from "react";
import { getDestinations, getPhotos, updatePhoto, uploadPhotos } from "../api";
import BulkActionBar from "./BulkActionBar";
import PhotoEditor from "./PhotoEditor";
import PhotoFilters from "./PhotoFilters";
import PhotoGrid from "./PhotoGrid";

const CONTENT_TYPE_OPTIONS = [
  { id: "all", label: "All", disabled: false },
  { id: "photos", label: "Photos", disabled: false },
  { id: "videos", label: "Videos", disabled: true }
];

function formatMonthRange(dateStart, dateEnd) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric"
  });

  return `${formatter.format(new Date(dateStart))} – ${formatter.format(new Date(dateEnd))}`;
}

function getPhotoTimestamp(photo) {
  const value = photo.captured_at || photo.uploaded_at;
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

function parseCsvList(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function TimelineView({ people, tags }) {
  const [destinations, setDestinations] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [filters, setFilters] = useState({});
  const [sortDirection, setSortDirection] = useState("newest");
  const [contentType, setContentType] = useState("all");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [editingPhoto, setEditingPhoto] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [activeDropZone, setActiveDropZone] = useState("");
  const [isUploadingToDestination, setIsUploadingToDestination] = useState(false);

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

  useEffect(() => {
    let isActive = true;

    async function loadTimelineData() {
      setIsLoading(true);
      setError("");

      try {
        const [destinationsResponse, photosResponse] = await Promise.all([
          getDestinations(),
          getPhotos(filters)
        ]);

        if (!isActive) {
          return;
        }

        const nextDestinations = destinationsResponse?.data || [];
        const nextPhotos = photosResponse?.data || [];

        setDestinations(nextDestinations);
        syncLoadedPhotos(nextPhotos, { resetSelection: true });
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

        const nextPhotos = photosResponse?.data || [];
        syncLoadedPhotos(nextPhotos);
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
    const undated = [];

    for (const photo of photos) {
      if (!photo.captured_at) {
        undated.push(photo);
        continue;
      }

      const matchingDestination = findMatchingDestination(photo, destinations);

      if (!matchingDestination) {
        undated.push(photo);
        continue;
      }

      photosByDestinationId.get(matchingDestination.id).push(photo);
    }

    const destinationBlocks = [...destinations]
      .sort((left, right) => {
        const comparison = new Date(left.date_start).getTime() - new Date(right.date_start).getTime();
        return sortDirection === "oldest" ? comparison : -comparison;
      })
      .map((destination) => ({
        ...destination,
        photos: sortPhotosForDisplay(photosByDestinationId.get(destination.id) || [], sortDirection)
      }));

    return {
      destinations: destinationBlocks,
      undated: sortPhotosForDisplay(undated, sortDirection)
    };
  }, [destinations, photos, sortDirection]);

  const activeMissingFilters = useMemo(() => parseCsvList(filters.missing), [filters.missing]);
  const showNoContentDestinations = activeMissingFilters.includes("no_content");

  const displayedDestinations = useMemo(() => {
    if (!showNoContentDestinations) {
      return groupedTimeline.destinations;
    }

    return groupedTimeline.destinations.filter((destination) => destination.photos.length === 0);
  }, [groupedTimeline.destinations, showNoContentDestinations]);

  const locationOptions = useMemo(() => ({
    neighborhoods: buildUniqueLocationOptions(photos, "neighborhood"),
    cities: buildUniqueLocationOptions(photos, "city"),
    regions: buildUniqueLocationOptions(photos, "region"),
    countries: buildUniqueLocationOptions(photos, "country")
  }), [photos]);
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

  function handleBulkAction() {
    setRefreshNonce((currentValue) => currentValue + 1);
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
              <p className="mt-2 text-sm text-stone-500">Fetching destinations and photos.</p>
            </div>
          </section>
        ) : hasActiveFilters && !showNoContentDestinations ? (
          <section className="panel flex min-h-0 flex-1 flex-col overflow-hidden p-6">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Filtered Results</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-900">
                  Showing filtered results — {photos.length} photo{photos.length === 1 ? "" : "s"}
                </h2>
              </div>

              <button type="button" onClick={handleClearFilters} className="btn-secondary">
                Clear Filters
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <PhotoGrid
                photos={sortPhotosForDisplay(photos, sortDirection)}
                onPhotoClick={setEditingPhoto}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
                embedded
                showSortControl={false}
              />
            </div>
          </section>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-8 pb-4">
              {displayedDestinations.map((destination) => (
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
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 py-5">
                    {destination.photos.length > 0 ? (
                      <PhotoGrid
                        photos={destination.photos}
                        onPhotoClick={setEditingPhoto}
                        selectedIds={selectedIds}
                        onSelectionChange={setSelectedIds}
                        embedded
                        showSortControl={false}
                      />
                    ) : (
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
                    )}
                  </div>
                </section>
              ))}

              {!showNoContentDestinations ? (
                <section className="border border-stone-300 bg-white">
                  <div className="border-b border-stone-200 px-5 py-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Undated</p>
                    <h2 className="mt-2 text-2xl font-semibold text-stone-900">Undated Photos</h2>
                    <p className="mt-2 text-sm text-stone-500">
                      {groupedTimeline.undated.length} photo{groupedTimeline.undated.length === 1 ? "" : "s"}
                    </p>
                  </div>

                  <div className="px-5 py-5">
                    {groupedTimeline.undated.length > 0 ? (
                      <PhotoGrid
                        photos={groupedTimeline.undated}
                        onPhotoClick={setEditingPhoto}
                        selectedIds={selectedIds}
                        onSelectionChange={setSelectedIds}
                        embedded
                        showSortControl={false}
                      />
                    ) : (
                      <p className="text-sm text-stone-500">No undated photos.</p>
                    )}
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
        ) : (
          <PhotoEditor
            photo={editingPhoto}
            people={people}
            tags={tags}
            locationOptions={locationOptions}
            onClose={() => setEditingPhoto(null)}
            onSaved={handleSavedPhoto}
            onDeleted={handleDeletedPhoto}
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

function buildUniqueLocationOptions(photos, field) {
  return [...new Set(
    photos
      .map((photo) => String(photo?.[field] || "").trim())
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right));
}

function findMatchingDestination(photo, destinations) {
  if (!photo.captured_at) {
    return null;
  }

  const photoTime = new Date(photo.captured_at).getTime();

  if (Number.isNaN(photoTime)) {
    return null;
  }

  const city = String(photo.city || "").trim().toLowerCase();
  const country = String(photo.country || "").trim().toLowerCase();

  if (city) {
    const cityMatches = destinations
      .filter((destination) => String(destination.city || "").trim().toLowerCase() === city)
      .filter((destination) => isWithinDateWindow(photoTime, destination, 3));

    if (cityMatches.length > 0) {
      return sortDestinationsByBestDateMatch(cityMatches, photoTime)[0];
    }
  }

  if (country) {
    const countryMatches = destinations
      .filter((destination) => String(destination.country || "").trim().toLowerCase() === country)
      .filter((destination) => isWithinDateRange(photoTime, destination));

    if (countryMatches.length > 0) {
      return sortDestinationsByContainedThenStart(countryMatches, photoTime)[0];
    }
  }

  const dateMatches = destinations.filter((destination) => isWithinDateRange(photoTime, destination));

  if (dateMatches.length > 0) {
    return sortDestinationsByContainedThenStart(dateMatches, photoTime)[0];
  }

  return null;
}

function isWithinDateWindow(photoTime, destination, toleranceDays) {
  const startTime = new Date(destination.date_start).getTime();
  const endTime = new Date(destination.date_end).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return false;
  }

  const toleranceMs = toleranceDays * 24 * 60 * 60 * 1000;
  return photoTime >= startTime - toleranceMs && photoTime < endTime + toleranceMs;
}

function isWithinDateRange(photoTime, destination) {
  const startTime = new Date(destination.date_start).getTime();
  const endTime = new Date(destination.date_end).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return false;
  }

  return photoTime >= startTime && photoTime < endTime;
}

function sortDestinationsByBestDateMatch(destinations, photoTime) {
  return [...destinations].sort((left, right) => {
    const leftContains = isWithinDateRange(photoTime, left);
    const rightContains = isWithinDateRange(photoTime, right);

    if (leftContains !== rightContains) {
      return leftContains ? -1 : 1;
    }

    return new Date(left.date_start).getTime() - new Date(right.date_start).getTime();
  });
}

function sortDestinationsByContainedThenStart(destinations, photoTime) {
  return [...destinations].sort((left, right) => {
    const leftContains = isWithinDateRange(photoTime, left);
    const rightContains = isWithinDateRange(photoTime, right);

    if (leftContains !== rightContains) {
      return leftContains ? -1 : 1;
    }

    return new Date(left.date_start).getTime() - new Date(right.date_start).getTime();
  });
}
