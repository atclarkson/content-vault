import { useEffect, useRef } from "react";

const SORT_OPTIONS = [
  { id: "newest", label: "Newest First" },
  { id: "oldest", label: "Oldest First" },
  { id: "uploaded_newest", label: "Recently Uploaded" },
  { id: "uploaded_oldest", label: "Oldest Uploads" },
  { id: "country", label: "Group by Country" },
  { id: "city", label: "Group by City" },
  { id: "filename", label: "Filename" }
];

function hasMissingMetadata(photo) {
  const missingTitle = !photo.title || !String(photo.title).trim();
  const missingPeople = !Array.isArray(photo.people) || photo.people.length === 0;
  const missingTags = !Array.isArray(photo.tags) || photo.tags.length === 0;

  return missingTitle || missingPeople || missingTags;
}

function toggleSelection(selectedIds, photoId, shouldSelect) {
  const nextSelectedIds = new Set(selectedIds);

  if (shouldSelect) {
    nextSelectedIds.add(photoId);
  } else {
    nextSelectedIds.delete(photoId);
  }

  return nextSelectedIds;
}

export default function PhotoGrid({
  photos,
  sort,
  onSortChange,
  onPhotoClick,
  selectedIds,
  onSelectionChange,
  embedded = false,
  showSortControl = true
}) {
  const photoCount = photos.length;
  const lastToggledIdRef = useRef(null);
  const dragSelectionRef = useRef({
    active: false,
    touchedIds: new Set(),
    selection: new Set(),
    shouldSelect: true,
    startPhotoId: null,
    startX: 0,
    startY: 0
  });
  const suppressClickRef = useRef(false);

  useEffect(() => {
    function handlePointerUp() {
      dragSelectionRef.current.active = false;
      dragSelectionRef.current.startPhotoId = null;
      dragSelectionRef.current.touchedIds = new Set();
    }

    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  function toggleRange(photoId, shouldSelect) {
    const nextSelectedIds = new Set(selectedIds);
    const currentIndex = photos.findIndex((photo) => photo.id === photoId);
    const lastIndex = photos.findIndex((photo) => photo.id === lastToggledIdRef.current);

    if (currentIndex === -1 || lastIndex === -1) {
      return toggleSelection(selectedIds, photoId, shouldSelect);
    }

    const startIndex = Math.min(currentIndex, lastIndex);
    const endIndex = Math.max(currentIndex, lastIndex);

    for (let index = startIndex; index <= endIndex; index += 1) {
      const rangePhotoId = photos[index].id;

      if (shouldSelect) {
        nextSelectedIds.add(rangePhotoId);
      } else {
        nextSelectedIds.delete(rangePhotoId);
      }
    }

    return nextSelectedIds;
  }

  function applyDraggedSelection(photoId) {
    if (dragSelectionRef.current.touchedIds.has(photoId)) {
      return;
    }

    dragSelectionRef.current.touchedIds.add(photoId);

    if (dragSelectionRef.current.shouldSelect) {
      dragSelectionRef.current.selection.add(photoId);
    } else {
      dragSelectionRef.current.selection.delete(photoId);
    }

    onSelectionChange(new Set(dragSelectionRef.current.selection));
  }

  function handleTilePointerDown(event, photoId, isSelected) {
    if (event.button !== 0) {
      return;
    }

    dragSelectionRef.current.active = false;
    dragSelectionRef.current.touchedIds = new Set();
    dragSelectionRef.current.selection = new Set(selectedIds);
    dragSelectionRef.current.shouldSelect = !isSelected;
    dragSelectionRef.current.startPhotoId = photoId;
    dragSelectionRef.current.startX = event.clientX;
    dragSelectionRef.current.startY = event.clientY;
  }

  function handleTilePointerMove(event, photoId) {
    const dragState = dragSelectionRef.current;

    if (dragState.startPhotoId !== photoId || dragState.active) {
      return;
    }

    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);

    if (distance < 6) {
      return;
    }

    dragState.active = true;
    suppressClickRef.current = true;
    lastToggledIdRef.current = photoId;
    applyDraggedSelection(photoId);
  }

  function handleTilePointerEnter(photoId) {
    if (!dragSelectionRef.current.active) {
      return;
    }

    lastToggledIdRef.current = photoId;
    applyDraggedSelection(photoId);
  }

  if (photoCount === 0) {
    return (
      <section className={embedded ? "" : "panel h-full overflow-hidden p-8"}>
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Photos</p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-900">0 photos</h2>
          </div>
        </div>

        <div className="rounded-[2rem] border border-dashed border-stone-300 bg-stone-50 px-8 py-16 text-center">
          <p className="text-lg font-medium text-stone-700">No photos match the current view.</p>
          <p className="mt-3 text-sm text-stone-500">
            Try clearing filters or upload a new batch to start building the catalog.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={embedded ? "" : "panel flex h-full min-h-0 flex-col overflow-hidden p-6"}>
      {!embedded ? (
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Photos</p>
            <h2 className="mt-2 text-2xl font-semibold text-stone-900">
              {photoCount} photo{photoCount === 1 ? "" : "s"}
            </h2>
          </div>

          {showSortControl ? (
            <div className="flex items-end gap-4">
              <label className="block min-w-[220px] text-right">
                <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Sort</span>
                <select value={sort} onChange={(event) => onSortChange(event.target.value)} className="field">
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={embedded ? "" : "min-h-0 flex-1 overflow-y-auto"}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {photos.map((photo) => {
            const isSelected = selectedIds.has(photo.id);
            const showWarning = hasMissingMetadata(photo);

            return (
              <article
                key={photo.id}
                onPointerDown={(event) => handleTilePointerDown(event, photo.id, isSelected)}
                onPointerMove={(event) => handleTilePointerMove(event, photo.id)}
                onPointerEnter={() => handleTilePointerEnter(photo.id)}
                className={`group relative overflow-hidden rounded-[1.75rem] border bg-stone-100 transition ${
                  isSelected
                    ? "border-amber-400 ring-2 ring-amber-300/80"
                    : "border-stone-300 hover:border-stone-400"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }

                    onPhotoClick(photo);
                  }}
                  className="block w-full select-none text-left"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-stone-200">
                    {photo.thumbnail_url ? (
                      <img
                        src={photo.thumbnail_url}
                        alt={photo.alt_text || photo.original_filename || "Photo thumbnail"}
                        draggable="false"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-stone-200 text-sm text-stone-500">
                        No thumbnail
                      </div>
                    )}

                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-stone-950/70 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />

                    <div className={`absolute left-3 top-3 z-10 transition ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) => {
                          event.stopPropagation();
                          const shouldSelect = event.target.checked;
                          const nextSelectedIds = event.nativeEvent.shiftKey
                            ? toggleRange(photo.id, shouldSelect)
                            : toggleSelection(selectedIds, photo.id, shouldSelect);

                          lastToggledIdRef.current = photo.id;
                          onSelectionChange(nextSelectedIds);
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                        className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
                      />
                    </div>

                    {showWarning ? (
                      <div
                        className="absolute right-3 top-3 h-3 w-3 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgba(255,255,255,0.8)]"
                        title="Missing title, people, or tags"
                      />
                    ) : null}

                    <div className="absolute inset-x-0 bottom-0 z-10 translate-y-full px-4 py-3 transition group-hover:translate-y-0">
                      <p className="truncate text-sm font-medium text-white">{photo.original_filename}</p>
                    </div>
                  </div>
                </button>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
