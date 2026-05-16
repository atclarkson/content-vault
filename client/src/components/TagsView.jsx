import { useEffect, useMemo, useRef, useState } from "react";
import { deleteTag, getPhotos, getTags, getVideos, updateTag } from "../api";

const COLOR_OPTIONS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-yellow-400",
  "bg-green-500",
  "bg-blue-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-gray-300",
  "bg-gray-600"
];

export default function TagsView({ tags: initialTags, refreshTags }) {
  const [sort, setSort] = useState("name");
  const [tags, setTags] = useState(initialTags || []);
  const [expandedTagId, setExpandedTagId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (sort === "name") {
      setTags(initialTags || []);
    }
  }, [initialTags, sort]);

  async function loadTags(nextSort = sort) {
    setIsLoading(true);
    setError("");

    try {
      const response = await getTags(nextSort);
      setTags(response?.data || []);
    } catch (loadError) {
      setError(loadError.message || "Failed to load tags");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadTags(sort);
  }, [sort]);

  async function handleRefreshTags() {
    await refreshTags();
    await loadTags(sort);
  }

  return (
    <section className="panel flex h-full min-h-0 flex-col overflow-hidden p-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Tags</p>
          <h2 className="mt-2 text-2xl font-semibold text-stone-900">Tags</h2>
          <p className="mt-3 text-sm text-stone-600">
            Tags are created automatically when added to photos or videos.
          </p>
        </div>

        <div className="flex gap-2">
          <button type="button" onClick={() => setSort("name")} className={sort === "name" ? "btn-primary" : "btn-secondary"}>
            A-Z
          </button>
          <button type="button" onClick={() => setSort("count")} className={sort === "count" ? "btn-primary" : "btn-secondary"}>
            Most Used
          </button>
        </div>
      </div>

      {error ? <div className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="text-sm text-stone-500">Loading tags...</div>
        ) : (
          <div className="divide-y divide-stone-200 border border-stone-300 bg-white">
            {tags.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                refreshTags={handleRefreshTags}
                isExpanded={expandedTagId === tag.id}
                onExpand={setExpandedTagId}
                onCollapse={() => setExpandedTagId((currentId) => (currentId === tag.id ? null : currentId))}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TagRow({ tag, refreshTags, isExpanded, onExpand, onCollapse }) {
  const [name, setName] = useState(tag.name || "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");
  const rowRef = useRef(null);
  const lastSavedRef = useRef(tag.name || "");
  const timeoutRef = useRef(null);
  const savePromiseRef = useRef(null);

  useEffect(() => {
    setName(tag.name || "");
    lastSavedRef.current = tag.name || "";
    setSaveState("idle");
    setError("");
  }, [tag]);

  useEffect(() => {
    if (!isExpanded) {
      return undefined;
    }

    function handlePointerDown(event) {
      const nextRow = event.target.closest("[data-tag-row-id]");

      if (nextRow) {
        const nextTagId = Number(nextRow.getAttribute("data-tag-row-id"));

        if (Number.isInteger(nextTagId) && nextTagId !== tag.id) {
          onExpand(nextTagId);
          return;
        }
      }

      if (rowRef.current && !rowRef.current.contains(event.target)) {
        onCollapse();
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onCollapse();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isExpanded, onCollapse]);

  const trimmedName = useMemo(() => name.trim(), [name]);

  async function persistName() {
    if (trimmedName === lastSavedRef.current) {
      return true;
    }

    if (!trimmedName) {
      setError("Tag name must be a non-empty string");
      setSaveState("error");
      return false;
    }

    if (savePromiseRef.current) {
      return savePromiseRef.current;
    }

    setIsSaving(true);
    setSaveState("saving");
    setError("");

    const savePromise = updateTag(tag.id, { name: trimmedName })
      .then(async () => {
        lastSavedRef.current = trimmedName;
        setSaveState("saved");
        await refreshTags();
        return true;
      })
      .catch((saveError) => {
        setError(saveError.message || "Failed to save tag");
        setSaveState("error");
        return false;
      })
      .finally(() => {
        setIsSaving(false);
        savePromiseRef.current = null;
      });

    savePromiseRef.current = savePromise;
    return savePromise;
  }

  useEffect(() => {
    if (!isExpanded || trimmedName === lastSavedRef.current) {
      return undefined;
    }

    setSaveState("dirty");

    timeoutRef.current = window.setTimeout(() => {
      persistName();
    }, 800);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [isExpanded, trimmedName]);

  useEffect(() => () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
  }, []);

  async function handleDelete(event) {
    event.stopPropagation();
    setIsDeleting(true);
    setError("");

    try {
      const [photosResponse, videosResponse] = await Promise.all([getPhotos(), getVideos()]);
      const photoCount = (photosResponse?.data || []).filter((photo) => (
        Array.isArray(photo.tags) && photo.tags.includes(tag.name)
      )).length;
      const videoCount = (videosResponse?.data || []).filter((video) => (
        Array.isArray(video.tags) && video.tags.includes(tag.name)
      )).length;

      if (!window.confirm(`This tag is used in ${photoCount} photos and ${videoCount} videos. Are you sure?`)) {
        setIsDeleting(false);
        return;
      }

      await deleteTag(tag.id);
      await refreshTags();
      onCollapse();
    } catch (deleteError) {
      setError(deleteError.message || "Failed to delete tag");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleColorChange(nextColor, event) {
    event.stopPropagation();
    setError("");

    try {
      await updateTag(tag.id, {
        color: tag.color === nextColor ? null : nextColor
      });
      await refreshTags();
      onCollapse();
    } catch (updateError) {
      setError(updateError.message || "Failed to update tag color");
    }
  }

  return (
    <article ref={rowRef} data-tag-row-id={tag.id} className="bg-white">
      <button
        type="button"
        onClick={() => (isExpanded ? onCollapse() : onExpand(tag.id))}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-stone-50"
      >
        <div className={`h-4 w-4 shrink-0 rounded-full border border-stone-300 ${tag.color || "bg-white"}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-stone-900">{tag.name}</p>
        </div>
        <div className="hidden shrink-0 items-center gap-4 text-sm text-stone-500 md:flex">
          <span>{tag.photo_count} photos</span>
          <span>{tag.video_count} videos</span>
        </div>
        <span className="btn-secondary px-4 py-2 text-sm">
          {isExpanded ? "Done" : "Edit"}
        </span>
      </button>

      {isExpanded ? (
        <div className="border-t border-stone-200 px-5 py-5">
          <div className="grid gap-4">
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="field max-w-[320px]"
              />
            </label>

            <div>
              <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Color</span>
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map((colorClass) => {
                  const isActive = tag.color === colorClass;

                  return (
                    <button
                      key={colorClass}
                      type="button"
                      onClick={(event) => handleColorChange(colorClass, event)}
                      className={`h-7 w-7 rounded-full border ${colorClass} ${
                        isActive ? "ring-2 ring-stone-900 ring-offset-2" : "border-stone-300"
                      }`}
                      title={colorClass}
                    />
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-stone-500">
              <div className="flex gap-4">
                <span>{tag.photo_count} photos</span>
                <span>{tag.video_count} videos</span>
              </div>
              <span>
                {saveState === "saving" && "Saving..."}
                {saveState === "saved" && "Saved"}
                {saveState === "dirty" && "Waiting to save..."}
                {saveState === "error" && "Save failed"}
                {saveState === "idle" && "Ready"}
              </span>
            </div>

            <div className="flex justify-end">
              <button type="button" onClick={handleDelete} disabled={isDeleting || isSaving} className="btn-secondary">
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>

          {error ? <div className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        </div>
      ) : null}
    </article>
  );
}
