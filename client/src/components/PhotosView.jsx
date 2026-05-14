import { useEffect, useState } from "react";
import { getPhotos } from "../api";
import BulkActionBar from "./BulkActionBar";
import PhotoFilters from "./PhotoFilters";
import PhotoGrid from "./PhotoGrid";
import PhotoEditor from "./PhotoEditor";

export default function PhotosView({ people, tags }) {
  const [photos, setPhotos] = useState([]);
  const [filters, setFilters] = useState({});
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
        const response = await getPhotos(filters);

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
  }, [filters, refreshNonce]);

  function handleApplyFilters(nextFilters) {
    setFilters(nextFilters);
  }

  function handleClearFilters() {
    setFilters({});
  }

  function handleSavedPhoto(updatedPhoto) {
    setPhotos((currentPhotos) => currentPhotos.map((photo) => (
      photo.id === updatedPhoto.id ? updatedPhoto : photo
    )));
    setEditingPhoto(null);
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

  return (
    <div className="relative flex flex-1 gap-6">
      <div className={`${editingPhoto ? "min-w-0 flex-1 pr-[28rem]" : "w-full"}`}>
        <PhotoFilters people={people} tags={tags} onApply={handleApplyFilters} onClear={handleClearFilters} />

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
          <PhotoGrid
            photos={photos}
            onPhotoClick={setEditingPhoto}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />
        )}
      </div>

      {editingPhoto ? (
        <PhotoEditor
          photo={editingPhoto}
          people={people}
          tags={tags}
          onClose={() => setEditingPhoto(null)}
          onSaved={handleSavedPhoto}
          onDeleted={handleDeletedPhoto}
        />
      ) : null}

      <BulkActionBar
        selectedIds={selectedIds}
        people={people}
        allTags={tags}
        onAction={handleBulkAction}
        onClear={() => setSelectedIds(new Set())}
      />
    </div>
  );
}
