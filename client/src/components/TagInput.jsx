import { useEffect, useMemo, useState } from "react";
import { getTagGroups, getTags, updateTag } from "../api";

const TAG_GROUP_COLOR_CLASSES = [
  "bg-red-500",
  "bg-orange-500",
  "bg-yellow-400",
  "bg-green-500",
  "bg-blue-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-gray-300",
  "bg-gray-600",
  "bg-[oklch(54.7%_0.021_43.1)]"
];

function normalizeTag(value) {
  return String(value || "").trim();
}

function normalizeTagKey(value) {
  return normalizeTag(value).toLowerCase();
}

function getGroupColorClass(color) {
  return TAG_GROUP_COLOR_CLASSES.includes(color) ? color : "bg-stone-400";
}

function buildFlatTagCatalog(allTags, tagGroups) {
  const byName = new Map();

  for (const tag of allTags || []) {
    if (tag?.name) {
      byName.set(normalizeTagKey(tag.name), {
        id: tag.id || null,
        name: tag.name,
        group_id: tag.group_id || null,
        group_name: tag.group_name || null,
        group_color: tag.group_color || null
      });
    }
  }

  for (const group of tagGroups || []) {
    for (const tag of group.tags || []) {
      if (!tag?.name) {
        continue;
      }

      const tagKey = normalizeTagKey(tag.name);
      const currentValue = byName.get(tagKey);
      byName.set(tagKey, {
        id: tag.id || currentValue?.id || null,
        name: tag.name,
        group_id: group.id,
        group_name: group.name,
        group_color: group.color
      });
    }
  }

  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function groupSuggestions(allTags, currentTags, inputValue) {
  const normalizedInput = normalizeTag(inputValue).toLowerCase();
  const appliedTagSet = new Set(currentTags.map((tag) => normalizeTagKey(tag)));
  const matchingTags = allTags.filter((tag) => {
    if (!tag?.name || appliedTagSet.has(normalizeTagKey(tag.name))) {
      return false;
    }

    return tag.name.toLowerCase().includes(normalizedInput);
  });
  const groups = new Map();

  for (const tag of matchingTags) {
    const groupKey = tag.group_id ? `group-${tag.group_id}` : "ungrouped";
    const currentGroup = groups.get(groupKey) || {
      key: groupKey,
      name: tag.group_name || "Ungrouped",
      color: tag.group_color || "",
      tags: []
    };

    currentGroup.tags.push(tag);
    groups.set(groupKey, currentGroup);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      tags: group.tags.sort((left, right) => left.name.localeCompare(right.name))
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export default function TagInput({ tags, allTags, tagGroups, onChange }) {
  const [inputValue, setInputValue] = useState("");
  const [allTagsSnapshot, setAllTagsSnapshot] = useState(allTags || []);
  const [tagGroupsSnapshot, setTagGroupsSnapshot] = useState(tagGroups || []);
  const [assigningTagName, setAssigningTagName] = useState("");
  const [isRefreshingGroups, setIsRefreshingGroups] = useState(false);
  const [error, setError] = useState("");
  const normalizedInput = normalizeTag(inputValue);

  useEffect(() => {
    setAllTagsSnapshot(allTags || []);
  }, [allTags]);

  useEffect(() => {
    setTagGroupsSnapshot(tagGroups || []);
  }, [tagGroups]);

  const flatTagCatalog = useMemo(
    () => buildFlatTagCatalog(allTagsSnapshot || [], tagGroupsSnapshot || []),
    [allTagsSnapshot, tagGroupsSnapshot]
  );

  const tagLookup = useMemo(() => {
    const map = new Map();

    for (const tag of flatTagCatalog) {
      map.set(normalizeTagKey(tag.name), tag);
    }

    return map;
  }, [flatTagCatalog]);

  const appliedTags = useMemo(() => (
    tags.map((tagName) => tagLookup.get(normalizeTagKey(tagName)) || {
      id: null,
      name: tagName,
      group_id: null,
      group_name: null,
      group_color: null
    })
  ), [tagLookup, tags]);

  const suggestions = useMemo(() => {
    if (!normalizedInput) {
      return [];
    }

    return groupSuggestions(flatTagCatalog, tags, normalizedInput).slice(0, 8);
  }, [flatTagCatalog, normalizedInput, tags]);

  async function refreshLocalTagData() {
    setIsRefreshingGroups(true);

    try {
      const [tagsResponse, groupsResponse] = await Promise.all([getTags(), getTagGroups()]);
      const nextTags = tagsResponse?.data || [];
      const nextGroups = groupsResponse?.data || [];
      setAllTagsSnapshot(nextTags);
      setTagGroupsSnapshot(nextGroups);
      return {
        tags: nextTags,
        groups: nextGroups
      };
    } finally {
      setIsRefreshingGroups(false);
    }
  }

  function addTag(nextTag) {
    const normalizedTag = normalizeTag(nextTag);
    const normalizedTagKey = normalizeTagKey(nextTag);
    const existingTag = tagLookup.get(normalizedTagKey);

    if (!normalizedTag || tags.some((tag) => normalizeTagKey(tag) === normalizedTagKey)) {
      setInputValue("");
      return;
    }

    onChange([...tags, existingTag?.name || normalizedTag]);
    setInputValue("");
    setAssigningTagName(existingTag?.name || normalizedTag);
    setError("");
  }

  function removeTag(tagToRemove) {
    const tagKeyToRemove = normalizeTagKey(tagToRemove);
    onChange(tags.filter((tag) => normalizeTagKey(tag) !== tagKeyToRemove));

    if (normalizeTagKey(assigningTagName) === tagKeyToRemove) {
      setAssigningTagName("");
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag(inputValue);
    }
  }

  async function handleOpenAssignment(tagRecord) {
    setError("");
    setAssigningTagName(tagRecord.name);

    if (!tagRecord.id || !tagRecord.group_id) {
      await refreshLocalTagData();
    }
  }

  async function handleAssignGroup(tagName, groupId) {
    setError("");
    const normalizedTagKey = normalizeTagKey(tagName);

    const latestData = await refreshLocalTagData();
    const latestCatalog = buildFlatTagCatalog(latestData.tags, latestData.groups);
    const latestTag = latestCatalog.find((entry) => normalizeTagKey(entry.name) === normalizedTagKey);

    if (!latestTag?.id) {
      setError("Tag is still saving. Try assigning the group again in a second.");
      return;
    }

    try {
      await updateTag(latestTag.id, { group_id: groupId });
      await refreshLocalTagData();
      setAssigningTagName("");
    } catch (assignmentError) {
      setError(assignmentError.message || "Failed to assign tag group");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {appliedTags.length === 0 ? (
          <p className="text-sm text-stone-500">No tags yet.</p>
        ) : (
          appliedTags.map((tagRecord) => {
            const isAssigning = assigningTagName === tagRecord.name;
            const hasGroup = Boolean(tagRecord.group_id);

            return (
              <span
                key={tagRecord.name}
                className="relative inline-flex items-center gap-2 rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-sm text-stone-700"
              >
                <span className={`h-2.5 w-2.5 rounded-full border border-stone-400 ${getGroupColorClass(tagRecord.group_color)}`} />
                <span>{tagRecord.name}</span>

                {!hasGroup ? (
                  <button
                    type="button"
                    onClick={() => handleOpenAssignment(tagRecord)}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-stone-300 text-xs text-stone-600 transition hover:bg-white hover:text-stone-900"
                    title="Assign group"
                    aria-label={`Assign a group to ${tagRecord.name}`}
                  >
                    +
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => removeTag(tagRecord.name)}
                  className="text-stone-500 transition hover:text-stone-900"
                  aria-label={`Remove ${tagRecord.name}`}
                >
                  ×
                </button>

                {isAssigning && !hasGroup ? (
                  <div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 min-w-[220px] rounded-[1rem] border border-stone-300 bg-white p-2 shadow-panel">
                    <p className="px-2 py-1 text-xs uppercase tracking-[0.2em] text-stone-500">Assign Group</p>
                    <div className="mt-1 max-h-56 overflow-y-auto">
                      {(tagGroupsSnapshot || []).map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => handleAssignGroup(tagRecord.name, group.id)}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-stone-700 transition hover:bg-stone-100"
                        >
                          <span className={`h-2.5 w-2.5 rounded-full border border-stone-400 ${getGroupColorClass(group.color)}`} />
                          <span>{group.name}</span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 px-2 text-xs text-stone-500">
                      {isRefreshingGroups ? "Refreshing groups..." : "Pick a group for this new tag."}
                    </div>
                  </div>
                ) : null}
              </span>
            );
          })
        )}
      </div>

      {error ? <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="relative mt-3">
        <input
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={handleKeyDown}
          className="field"
          placeholder="Add tag..."
        />

        {suggestions.length > 0 ? (
          <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 rounded-[1.25rem] border border-stone-300 bg-white p-2 shadow-panel">
            <div className="max-h-72 overflow-y-auto">
              {suggestions.map((group) => (
                <div key={group.key} className="mb-2 last:mb-0">
                  <div className="mb-1 flex items-center gap-2 px-3 py-1">
                    <span className={`h-2.5 w-2.5 rounded-full border border-stone-400 ${getGroupColorClass(group.color)}`} />
                    <p className="text-xs uppercase tracking-[0.2em] text-stone-500">{group.name}</p>
                  </div>
                  <div className="space-y-1">
                    {group.tags.map((suggestion) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        onClick={() => addTag(suggestion.name)}
                        className="block w-full rounded-2xl px-3 py-2 text-left text-sm text-stone-700 transition hover:bg-stone-100"
                      >
                        {suggestion.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
