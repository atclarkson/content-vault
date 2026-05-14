import { useMemo, useState } from "react";

function normalizeTag(value) {
  return String(value || "").trim();
}

export default function TagInput({ tags, allTags, onChange }) {
  const [inputValue, setInputValue] = useState("");
  const normalizedInput = normalizeTag(inputValue);

  const suggestions = useMemo(() => {
    if (!normalizedInput) {
      return [];
    }

    const lowercaseInput = normalizedInput.toLowerCase();

    return allTags
      .map((tag) => tag.name)
      .filter((tagName) => !tags.includes(tagName))
      .filter((tagName) => tagName.toLowerCase().includes(lowercaseInput))
      .slice(0, 8);
  }, [allTags, normalizedInput, tags]);

  function addTag(nextTag) {
    const normalizedTag = normalizeTag(nextTag);

    if (!normalizedTag || tags.includes(normalizedTag)) {
      setInputValue("");
      return;
    }

    onChange([...tags, normalizedTag]);
    setInputValue("");
  }

  function removeTag(tagToRemove) {
    onChange(tags.filter((tag) => tag !== tagToRemove));
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag(inputValue);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 ? (
          <p className="text-sm text-stone-500">No tags yet.</p>
        ) : (
          tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-sm text-stone-700"
            >
              <span>{tag}</span>
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="text-stone-500 transition hover:text-stone-900"
                aria-label={`Remove ${tag}`}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

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
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => addTag(suggestion)}
                className="block w-full rounded-2xl px-3 py-2 text-left text-sm text-stone-700 transition hover:bg-stone-100"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
