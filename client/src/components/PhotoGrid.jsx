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

export default function PhotoGrid({ photos, onPhotoClick, selectedIds, onSelectionChange }) {
  const photoCount = photos.length;

  if (photoCount === 0) {
    return (
      <section className="panel p-8">
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
    <section className="panel p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Photos</p>
          <h2 className="mt-2 text-2xl font-semibold text-stone-900">
            {photoCount} photo{photoCount === 1 ? "" : "s"}
          </h2>
        </div>

        <p className="text-sm text-stone-500">
          Hover a tile to select it or open it in the editor.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {photos.map((photo) => {
          const isSelected = selectedIds.has(photo.id);
          const showWarning = hasMissingMetadata(photo);

          return (
            <article
              key={photo.id}
              className={`group relative overflow-hidden rounded-[1.75rem] border bg-stone-100 transition ${
                isSelected
                  ? "border-amber-400 ring-2 ring-amber-300/80"
                  : "border-stone-300 hover:border-stone-400"
              }`}
            >
              <button
                type="button"
                onClick={() => onPhotoClick(photo)}
                className="block w-full text-left"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-stone-200">
                  {photo.thumbnail_url ? (
                    <img
                      src={photo.thumbnail_url}
                      alt={photo.alt_text || photo.original_filename || "Photo thumbnail"}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-stone-200 text-sm text-stone-500">
                      No thumbnail
                    </div>
                  )}

                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-stone-950/70 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />

                  <div className="absolute left-3 top-3 z-10 opacity-0 transition group-hover:opacity-100">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(event) => {
                        event.stopPropagation();
                        onSelectionChange(toggleSelection(selectedIds, photo.id, event.target.checked));
                      }}
                      onClick={(event) => {
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
    </section>
  );
}
