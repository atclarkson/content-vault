import { useEffect, useRef, useState } from "react";
import { appendPhotoVersion } from "../photoUrls";

const PHOTO_TILE_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "260px"
};

const SORT_OPTIONS = [
  { id: "newest", label: "Newest First" },
  { id: "oldest", label: "Oldest First" },
  { id: "uploaded_newest", label: "Recently Uploaded" },
  { id: "uploaded_oldest", label: "Oldest Uploads" },
  { id: "country", label: "Group by Country" },
  { id: "city", label: "Group by City" },
  { id: "filename", label: "Filename" }
];

function needsAiCaption(photo) {
  return !photo.ai_caption || !String(photo.ai_caption).trim();
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
  selectionAnchorRef,
  visiblePhotoIds,
  embedded = false,
  showSortControl = true
}) {
  const photoCount = photos.length;
  const internalSelectionAnchorRef = useRef(null);
  const suppressClickRef = useRef(false);
  const lastPointerTypeRef = useRef("");
  const touchSelectionRef = useRef({
    photoId: null,
    pointerId: null,
    startX: 0,
    startY: 0,
    longPressTriggered: false,
    timerId: null
  });
  const gridRef = useRef(null);
  const marqueeStateRef = useRef({
    pointerId: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    hasExceededThreshold: false,
    active: false,
    baselineSelection: new Set(),
    additive: false,
    firstTouchedId: null
  });
  const [marqueeRect, setMarqueeRect] = useState(null);
  const activeSelectionAnchorRef = selectionAnchorRef || internalSelectionAnchorRef;
  const orderedPhotoIds = visiblePhotoIds || photos.map((photo) => photo.id);

  useEffect(() => {
    return () => {
      if (touchSelectionRef.current.timerId) {
        window.clearTimeout(touchSelectionRef.current.timerId);
      }
    };
  }, []);

  function resetTouchSelection() {
    if (touchSelectionRef.current.timerId) {
      window.clearTimeout(touchSelectionRef.current.timerId);
    }

    touchSelectionRef.current = {
      photoId: null,
      pointerId: null,
      startX: 0,
      startY: 0,
      longPressTriggered: false,
      timerId: null
    };
  }

  function toggleRange(photoId, shouldSelect) {
    const nextSelectedIds = new Set(selectedIds);
    const currentIndex = orderedPhotoIds.indexOf(photoId);
    const lastIndex = orderedPhotoIds.indexOf(activeSelectionAnchorRef.current);

    if (currentIndex === -1 || lastIndex === -1) {
      return toggleSelection(selectedIds, photoId, shouldSelect);
    }

    const startIndex = Math.min(currentIndex, lastIndex);
    const endIndex = Math.max(currentIndex, lastIndex);

    for (let index = startIndex; index <= endIndex; index += 1) {
      const rangePhotoId = orderedPhotoIds[index];

      if (shouldSelect) {
        nextSelectedIds.add(rangePhotoId);
      } else {
        nextSelectedIds.delete(rangePhotoId);
      }
    }

    return nextSelectedIds;
  }
  function setAnchor(photoId) {
    activeSelectionAnchorRef.current = photoId;
  }

  function handleTilePointerDown(event, photoId, isSelected) {
    lastPointerTypeRef.current = event.pointerType || "";

    if (event.pointerType === "touch") {
      suppressClickRef.current = false;
      touchSelectionRef.current.photoId = photoId;
      touchSelectionRef.current.pointerId = event.pointerId;
      touchSelectionRef.current.startX = event.clientX;
      touchSelectionRef.current.startY = event.clientY;
      touchSelectionRef.current.longPressTriggered = false;
      touchSelectionRef.current.timerId = window.setTimeout(() => {
        touchSelectionRef.current.longPressTriggered = true;
        suppressClickRef.current = true;
        navigator.vibrate?.(10);
        onSelectionChange(toggleSelection(selectedIds, photoId, true));
        setAnchor(photoId);
      }, 500);
      return;
    }

    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }

    if (event.button !== 0) {
      return;
    }
  }

  function handleTilePointerMove(event, photoId) {
    if (event.pointerType === "touch") {
      const touchState = touchSelectionRef.current;

      if (touchState.pointerId !== event.pointerId || touchState.photoId !== photoId) {
        return;
      }

      const distance = Math.hypot(event.clientX - touchState.startX, event.clientY - touchState.startY);

      if (distance > 8 && !touchState.longPressTriggered) {
        resetTouchSelection();
      }

      return;
    }

    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }
  }

  function handleTilePointerUp(event, photoId, isSelected) {
    if (event.pointerType !== "touch") {
      return;
    }

    const touchState = touchSelectionRef.current;

    if (touchState.pointerId !== event.pointerId || touchState.photoId !== photoId) {
      return;
    }

    if (touchState.longPressTriggered) {
      resetTouchSelection();
      return;
    }

    resetTouchSelection();

    if (selectedIds.size >= 1) {
      suppressClickRef.current = true;
      onSelectionChange(toggleSelection(selectedIds, photoId, !isSelected));
    }
  }

  function handleTilePointerCancel(event, photoId) {
    if (event.pointerType !== "touch") {
      return;
    }

    if (touchSelectionRef.current.photoId === photoId) {
      resetTouchSelection();
    }
  }

  function computeMarqueeRect(startX, startY, currentX, currentY) {
    return {
      left: Math.min(startX, currentX),
      top: Math.min(startY, currentY),
      width: Math.abs(currentX - startX),
      height: Math.abs(currentY - startY)
    };
  }

  function rectsIntersect(rect, bounds) {
    return !(
      rect.left + rect.width < bounds.left
      || rect.left > bounds.right
      || rect.top + rect.height < bounds.top
      || rect.top > bounds.bottom
    );
  }

  function updateMarqueeSelection() {
    const marqueeState = marqueeStateRef.current;
    const rect = computeMarqueeRect(
      marqueeState.startX,
      marqueeState.startY,
      marqueeState.currentX,
      marqueeState.currentY
    );
    const tileElements = [...(gridRef.current?.querySelectorAll("[data-photo-tile='true']") || [])];
    const hitIds = tileElements
      .filter((element) => rectsIntersect(rect, element.getBoundingClientRect()))
      .map((element) => Number(element.dataset.photoId))
      .filter((photoId) => Number.isInteger(photoId));

    if (hitIds.length > 0 && marqueeState.firstTouchedId === null) {
      marqueeState.firstTouchedId = hitIds[0];
      setAnchor(hitIds[0]);
    }

    const nextSelectedIds = marqueeState.additive
      ? new Set([...marqueeState.baselineSelection, ...hitIds])
      : new Set(hitIds);

    onSelectionChange(nextSelectedIds);
    setMarqueeRect(rect);
  }

  function handleGridPointerDown(event) {
    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    marqueeStateRef.current.pointerId = event.pointerId;
    marqueeStateRef.current.startX = event.clientX;
    marqueeStateRef.current.startY = event.clientY;
    marqueeStateRef.current.currentX = event.clientX;
    marqueeStateRef.current.currentY = event.clientY;
    marqueeStateRef.current.hasExceededThreshold = false;
    marqueeStateRef.current.active = false;
    marqueeStateRef.current.baselineSelection = new Set(selectedIds);
    marqueeStateRef.current.additive = event.shiftKey || event.metaKey || event.ctrlKey;
    marqueeStateRef.current.firstTouchedId = null;
  }

  function handleGridPointerMove(event) {
    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }

    const marqueeState = marqueeStateRef.current;

    if (marqueeState.pointerId !== event.pointerId) {
      return;
    }

    marqueeState.currentX = event.clientX;
    marqueeState.currentY = event.clientY;

    if (!marqueeState.hasExceededThreshold) {
      const distance = Math.hypot(event.clientX - marqueeState.startX, event.clientY - marqueeState.startY);

      if (distance < 6) {
        return;
      }

      marqueeState.hasExceededThreshold = true;
      marqueeState.active = true;
      suppressClickRef.current = true;
      gridRef.current?.setPointerCapture?.(event.pointerId);
    }

    if (!marqueeState.active) {
      return;
    }

    updateMarqueeSelection();
  }

  function handleGridPointerUp(event) {
    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }

    const marqueeState = marqueeStateRef.current;

    if (marqueeState.pointerId !== event.pointerId) {
      return;
    }

    if (marqueeState.active) {
      suppressClickRef.current = true;
    }

    marqueeState.pointerId = null;
    marqueeState.active = false;
    marqueeState.hasExceededThreshold = false;
    marqueeState.firstTouchedId = null;
    setMarqueeRect(null);
  }

  function handleGridPointerCancel(event) {
    if (event.pointerType && event.pointerType !== "mouse") {
      return;
    }

    if (marqueeStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    marqueeStateRef.current.pointerId = null;
    marqueeStateRef.current.active = false;
    marqueeStateRef.current.hasExceededThreshold = false;
    marqueeStateRef.current.firstTouchedId = null;
    setMarqueeRect(null);
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
        <div
          ref={gridRef}
          onPointerDown={handleGridPointerDown}
          onPointerMove={handleGridPointerMove}
          onPointerUp={handleGridPointerUp}
          onPointerCancel={handleGridPointerCancel}
          className="relative"
        >
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {photos.map((photo) => {
            const isSelected = selectedIds.has(photo.id);
            const showWarning = needsAiCaption(photo);

            return (
              <article
                key={photo.id}
                data-photo-tile="true"
                data-photo-id={photo.id}
                onPointerDown={(event) => handleTilePointerDown(event, photo.id, isSelected)}
                onPointerMove={(event) => handleTilePointerMove(event, photo.id)}
                onPointerUp={(event) => handleTilePointerUp(event, photo.id, isSelected)}
                onPointerCancel={(event) => handleTilePointerCancel(event, photo.id)}
                style={PHOTO_TILE_STYLE}
                className={`group relative overflow-hidden rounded-[1.75rem] border bg-stone-100 transition ${
                  isSelected
                    ? "border-amber-400 ring-2 ring-amber-300/80"
                    : "border-stone-300 hover:border-stone-400"
                }`}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }

                    if (lastPointerTypeRef.current === "touch" && selectedIds.size >= 1) {
                      const shouldSelect = !isSelected;
                      const nextSelectedIds = toggleSelection(selectedIds, photo.id, shouldSelect);
                      onSelectionChange(nextSelectedIds);
                      return;
                    }

                    const shiftKey = Boolean(event.shiftKey);
                    const metaOrCtrlKey = Boolean(event.metaKey || event.ctrlKey);

                    if (shiftKey) {
                      const anchorId = activeSelectionAnchorRef.current;

                      if (!anchorId) {
                        const nextSelectedIds = toggleSelection(selectedIds, photo.id, !isSelected);
                        onSelectionChange(nextSelectedIds);
                        setAnchor(photo.id);
                        return;
                      }

                      const nextSelectedIds = toggleRange(photo.id, true);
                      onSelectionChange(nextSelectedIds);
                      return;
                    }

                    if (metaOrCtrlKey) {
                      const nextSelectedIds = toggleSelection(selectedIds, photo.id, !isSelected);
                      onSelectionChange(nextSelectedIds);
                      setAnchor(photo.id);
                      return;
                    }

                    onPhotoClick(photo);
                  }}
                  className="block w-full select-none text-left"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-stone-200">
                    {photo.thumbnail_url ? (
                      <img
                        src={appendPhotoVersion(photo.thumbnail_url, photo)}
                        alt={photo.alt_text || photo.original_filename || "Photo thumbnail"}
                        loading="lazy"
                        decoding="async"
                        draggable="false"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-stone-200 text-sm text-stone-500">
                        No thumbnail
                      </div>
                    )}

                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-stone-950/70 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />

                    <div className={`absolute left-3 top-3 z-10 hidden xl:block transition ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) => {
                          event.stopPropagation();
                          const shouldSelect = event.target.checked;
                          const nextSelectedIds = toggleSelection(selectedIds, photo.id, shouldSelect);
                          onSelectionChange(nextSelectedIds);
                          setAnchor(photo.id);
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
                        title="Needs AI caption"
                      />
                    ) : null}

                    <div className="absolute inset-x-0 bottom-0 z-10 min-w-0 translate-y-full px-4 py-3 transition group-hover:translate-y-0">
                      <p className="truncate text-sm font-medium text-white">{photo.original_filename}</p>
                    </div>
                  </div>
                </button>
              </article>
            );
          })}
          </div>
          {marqueeRect ? (
            <div
              className="pointer-events-none absolute z-20 border border-amber-400 bg-amber-200/20"
              style={{
                left: `${marqueeRect.left - (gridRef.current?.getBoundingClientRect().left || 0)}px`,
                top: `${marqueeRect.top - (gridRef.current?.getBoundingClientRect().top || 0)}px`,
                width: `${marqueeRect.width}px`,
                height: `${marqueeRect.height}px`
              }}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
