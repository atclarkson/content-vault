import { useEffect, useMemo, useState } from "react";
import { getPhotos } from "../api";
import BulkActionBar from "./BulkActionBar";
import PhotoFilters from "./PhotoFilters";
import PhotoGrid from "./PhotoGrid";
import PhotoEditor from "./PhotoEditor";

export default function PhotosView({ people, tags }) {
  const [photos, setPhotos] = useState([]);
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState("newest");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [editingPhoto, setEditingPhoto] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let isActive = true;

    async function loadPhotos() {
      setIsLoading(true);
      setError("");

      try {
        const response = await getPhotos({ ...filters, sort });

        if (!isActive) {
          return;
        }

        const nextPhotos = response?.data || [];

        setPhotos(nextPhotos);
        setSelectedIds(new Set());
        setEditingPhoto((currentPhoto) => {
          if (!currentPhoto) {
            return null;
          }

          return nextPhotos.find((photo) => photo.id === currentPhoto.id) || null;
        });
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setError(loadError.message || "Failed to load photos");
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadPhotos();

    return () => {
      isActive = false;
    };
  }, [filters, refreshNonce, sort]);

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

  function navigatePhoto(offset) {
    if (!editingPhoto) {
      return;
    }

    const currentIndex = photos.findIndex((photo) => photo.id === editingPhoto.id);

    if (currentIndex === -1) {
      return;
    }

    const nextPhoto = photos[currentIndex + offset];

    if (!nextPhoto) {
      return;
    }

    setEditingPhoto(nextPhoto);
  }

  const locationOptions = useMemo(() => ({
    neighborhoods: buildUniqueLocationOptions(photos, "neighborhood"),
    cities: buildUniqueLocationOptions(photos, "city"),
    regions: buildUniqueLocationOptions(photos, "region"),
    countries: buildUniqueLocationOptions(photos, "country")
  }), [photos]);
  const isBulkEditing = selectedIds.size > 1;

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

        {error ? (
          <div className="panel mb-6 border-red-300/70 bg-red-50 px-5 py-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <section className="panel flex min-h-[360px] items-center justify-center p-8">
            <div className="text-center">
              <p className="text-sm font-medium text-stone-700">Loading photos...</p>
              <p className="mt-2 text-sm text-stone-500">Fetching the current catalog view.</p>
            </div>
          </section>
        ) : (
          <div className="min-h-0 flex-1 overflow-hidden">
            <PhotoGrid
              photos={photos}
              sort={sort}
              onSortChange={setSort}
              onPhotoClick={setEditingPhoto}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
            />
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
            onNavigatePrevious={() => navigatePhoto(-1)}
            onNavigateNext={() => navigatePhoto(1)}
          />
        )}
      </div>
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
