import { useEffect, useMemo, useRef, useState } from "react";
import { deleteTag, getTagGroups, mergeTags, updateTag } from "../api";

function getGroupColorClass(color) {
  return String(color || "").trim() || "bg-stone-400";
}

export default function TagsView({ tagGroups: initialTagGroups, refreshTags, refreshTagGroups }) {
  const [sort, setSort] = useState("name");
  const [tagGroups, setTagGroups] = useState(initialTagGroups || []);
  const [expandedTagId, setExpandedTagId] = useState(null);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isMerging, setIsMerging] = useState(false);
  const [showMergeUi, setShowMergeUi] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setTagGroups(initialTagGroups || []);
    setIsLoading(false);

    setCollapsedGroups((currentValue) => {
      const nextValue = { ...currentValue };

      for (const group of initialTagGroups || []) {
        if (!Object.prototype.hasOwnProperty.call(nextValue, group.id)) {
          nextValue[group.id] = true;
        }
      }

      return nextValue;
    });
  }, [initialTagGroups]);

  const groupsWithTags = useMemo(() => {
    return (tagGroups || []).map((group) => ({
      ...group,
      tags: [...(group.tags || [])].sort((left, right) => {
        if (sort === "count") {
          const leftCount = Number(left.photo_count || 0) + Number(left.video_count || 0);
          const rightCount = Number(right.photo_count || 0) + Number(right.video_count || 0);
          return rightCount - leftCount || left.name.localeCompare(right.name);
        }

        return left.name.localeCompare(right.name);
      })
    }));
  }, [sort, tagGroups]);

  const allTags = useMemo(() => groupsWithTags.flatMap((group) => group.tags), [groupsWithTags]);

  async function refreshAllTagData() {
    setError("");
    const [tagGroupsResponse] = await Promise.all([
      getTagGroups(),
      refreshTags(),
      refreshTagGroups()
    ]);
    setTagGroups(tagGroupsResponse?.data || []);
  }

  async function handleMerge() {
    if (!mergeSourceId || !mergeTargetId) {
      return;
    }

    setIsMerging(true);
    setError("");

    try {
      await mergeTags(Number(mergeSourceId), Number(mergeTargetId));
      await refreshAllTagData();
      setMergeSourceId("");
      setMergeTargetId("");
      setShowMergeUi(false);
      setExpandedTagId(null);
    } catch (mergeError) {
      setError(mergeError.message || "Failed to merge tags");
    } finally {
      setIsMerging(false);
    }
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

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSort("name")} className={sort === "name" ? "btn-primary" : "btn-secondary"}>
            A-Z
          </button>
          <button type="button" onClick={() => setSort("count")} className={sort === "count" ? "btn-primary" : "btn-secondary"}>
            Most Used
          </button>
          <button type="button" onClick={() => setShowMergeUi((currentValue) => !currentValue)} className="btn-secondary">
            Merge Tags
          </button>
        </div>
      </div>

      {showMergeUi ? (
        <div className="mb-4 border border-stone-300 bg-white px-5 py-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Source Tag</span>
              <select value={mergeSourceId} onChange={(event) => setMergeSourceId(event.target.value)} className="field">
                <option value="">Select source tag</option>
                {allTags.map((tag) => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Target Tag</span>
              <select value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)} className="field">
                <option value="">Select target tag</option>
                {allTags
                  .filter((tag) => String(tag.id) !== String(mergeSourceId))
                  .map((tag) => (
                    <option key={tag.id} value={tag.id}>{tag.name}</option>
                  ))}
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="button"
                onClick={handleMerge}
                disabled={isMerging || !mergeSourceId || !mergeTargetId}
                className="btn-primary w-full"
              >
                {isMerging ? "Merging..." : "Confirm Merge"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <div className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="text-sm text-stone-500">Loading tag groups...</div>
        ) : groupsWithTags.length === 0 ? (
          <div className="text-sm text-stone-500">No tag groups yet.</div>
        ) : (
          <div className="space-y-5">
            {groupsWithTags.map((group) => {
              const isCollapsed = Boolean(collapsedGroups[group.id]);

              return (
                <section key={group.id} className="border border-stone-300 bg-white">
                  <button
                    type="button"
                    onClick={() => setCollapsedGroups((currentValue) => ({
                      ...currentValue,
                      [group.id]: !currentValue[group.id]
                    }))}
                    className="flex w-full items-center justify-between gap-4 border-l-4 px-5 py-4 text-left"
                    style={{ borderLeftColor: "transparent" }}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`h-3 w-3 rounded-full border border-stone-400 ${getGroupColorClass(group.color)}`} />
                      <div>
                        <p className="text-sm font-semibold text-stone-900">{group.name}</p>
                        <p className="mt-1 text-sm text-stone-500">{group.tags.length} tag{group.tags.length === 1 ? "" : "s"}</p>
                      </div>
                    </div>
                    <span className={`text-stone-500 transition ${isCollapsed ? "-rotate-90" : "rotate-0"}`}>⌄</span>
                  </button>

                  {!isCollapsed ? (
                    <div className="divide-y divide-stone-200 border-t border-stone-200">
                      {group.tags.map((tag) => (
                        <TagRow
                          key={tag.id}
                          tag={tag}
                          groups={groupsWithTags}
                          isExpanded={expandedTagId === tag.id}
                          onExpand={setExpandedTagId}
                          onCollapse={() => setExpandedTagId((currentId) => (currentId === tag.id ? null : currentId))}
                          refreshTagData={refreshAllTagData}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function TagRow({ tag, groups, isExpanded, onExpand, onCollapse, refreshTagData }) {
  const [name, setName] = useState(tag.name || "");
  const [selectedGroupId, setSelectedGroupId] = useState(tag.group_id ? String(tag.group_id) : "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");
  const rowRef = useRef(null);
  const lastSavedNameRef = useRef(tag.name || "");
  const timeoutRef = useRef(null);
  const savePromiseRef = useRef(null);

  useEffect(() => {
    setName(tag.name || "");
    setSelectedGroupId(tag.group_id ? String(tag.group_id) : "");
    lastSavedNameRef.current = tag.name || "";
    setSaveState("idle");
    setError("");
  }, [tag]);

  useEffect(() => {
    if (!isExpanded) {
      return undefined;
    }

    rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });

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
  }, [isExpanded, onCollapse, onExpand, tag.id]);

  useEffect(() => () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
  }, []);

  const trimmedName = useMemo(() => name.trim(), [name]);

  async function persistName() {
    if (trimmedName === lastSavedNameRef.current) {
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
        lastSavedNameRef.current = trimmedName;
        setSaveState("saved");
        await refreshTagData();
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
    if (!isExpanded || trimmedName === lastSavedNameRef.current) {
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

  async function handleGroupChange(nextGroupId) {
    setSelectedGroupId(nextGroupId);
    setError("");

    try {
      await updateTag(tag.id, {
        group_id: nextGroupId ? Number(nextGroupId) : null
      });
      await refreshTagData();
      onCollapse();
    } catch (updateError) {
      setError(updateError.message || "Failed to move tag");
    }
  }

  async function handleDelete(event) {
    event.stopPropagation();

    if (!window.confirm(`This tag is used in ${tag.photo_count} photos and ${tag.video_count} videos. Are you sure?`)) {
      return;
    }

    setIsDeleting(true);
    setError("");

    try {
      await deleteTag(tag.id);
      await refreshTagData();
      onCollapse();
    } catch (deleteError) {
      setError(deleteError.message || "Failed to delete tag");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <article ref={rowRef} data-tag-row-id={tag.id} className="bg-white">
      <button
        type="button"
        onClick={() => (isExpanded ? onCollapse() : onExpand(tag.id))}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-stone-50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-stone-900">{tag.name}</p>
        </div>
        <div className="hidden shrink-0 items-center gap-4 text-sm text-stone-500 md:flex">
          <span>{tag.photo_count} photos</span>
          <span>{tag.video_count} videos</span>
        </div>
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

            <label className="block">
              <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Group</span>
              <select
                value={selectedGroupId}
                onChange={(event) => handleGroupChange(event.target.value)}
                className="field max-w-[320px]"
              >
                <option value="">Ungrouped</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>

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
