import { useEffect, useMemo, useRef, useState } from "react";

const MISSING_FIELD_OPTIONS = [
  { id: "location", label: "Location" },
  { id: "people", label: "People" },
  { id: "tags", label: "Tags" },
  { id: "title", label: "Title" },
  { id: "alt_text", label: "Alt Text" }
];

function toggleValue(values, nextValue) {
  const nextValues = new Set(values);

  if (nextValues.has(nextValue)) {
    nextValues.delete(nextValue);
  } else {
    nextValues.add(nextValue);
  }

  return Array.from(nextValues);
}

function buildFilterPayload(filters) {
  const payload = {};

  if (filters.country.trim()) {
    payload.country = filters.country.trim();
  }

  if (filters.city.trim()) {
    payload.city = filters.city.trim();
  }

  if (filters.missing.length > 0) {
    payload.missing = filters.missing.join(",");
  }

  if (filters.people.length > 0) {
    payload.people = filters.people.join(",");
  }

  if (filters.tags.length > 0) {
    payload.tags = filters.tags.join(",");
  }

  return payload;
}

function countActiveFilters(filters) {
  let count = 0;

  if (filters.country.trim()) {
    count += 1;
  }

  if (filters.city.trim()) {
    count += 1;
  }

  count += filters.missing.length;
  count += filters.people.length;
  count += filters.tags.length;

  return count;
}

function FilterDropdown({ label, selectedCount, children }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        className="btn-secondary min-w-[180px] justify-between gap-3"
      >
        <span>{label}</span>
        <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-700">
          {selectedCount}
        </span>
      </button>

      {isOpen ? (
        <div className="absolute left-0 top-[calc(100%+0.75rem)] z-20 max-h-72 w-72 overflow-auto rounded-[1.5rem] border border-stone-300 bg-white p-4 shadow-panel">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export default function PhotoFilters({ people, tags, onApply, onClear }) {
  const [filters, setFilters] = useState({
    missing: [],
    country: "",
    city: "",
    people: [],
    tags: []
  });

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters]);

  function updateField(field, value) {
    setFilters((currentFilters) => ({
      ...currentFilters,
      [field]: value
    }));
  }

  function handleApply() {
    onApply(buildFilterPayload(filters));
  }

  function handleClear() {
    const nextFilters = {
      missing: [],
      country: "",
      city: "",
      people: [],
      tags: []
    };

    setFilters(nextFilters);
    onClear();
  }

  return (
    <section className="panel mb-6 p-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Filters</p>
          <h2 className="mt-2 text-xl font-semibold text-stone-900">Photo filters</h2>
        </div>

        <div className="rounded-full bg-stone-200 px-3 py-1 text-sm font-medium text-stone-700">
          {activeFilterCount} active
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1.1fr_auto_auto]">
        <label className="block">
          <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">Country</span>
          <input
            type="text"
            value={filters.country}
            onChange={(event) => updateField("country", event.target.value)}
            className="field"
            placeholder="Japan"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">City</span>
          <input
            type="text"
            value={filters.city}
            onChange={(event) => updateField("city", event.target.value)}
            className="field"
            placeholder="Tokyo"
          />
        </label>

        <div className="flex items-end">
          <FilterDropdown label="People" selectedCount={filters.people.length}>
            <div className="space-y-2">
              {people.length === 0 ? (
                <p className="text-sm text-stone-500">No people available yet.</p>
              ) : (
                people.map((person) => (
                  <label key={person.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-stone-100">
                    <input
                      type="checkbox"
                      checked={filters.people.includes(person.name)}
                      onChange={() => updateField("people", toggleValue(filters.people, person.name))}
                      className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
                    />
                    <span className="text-sm text-stone-700">{person.name}</span>
                  </label>
                ))
              )}
            </div>
          </FilterDropdown>
        </div>

        <div className="flex items-end">
          <FilterDropdown label="Tags" selectedCount={filters.tags.length}>
            <div className="space-y-2">
              {tags.length === 0 ? (
                <p className="text-sm text-stone-500">No tags available yet.</p>
              ) : (
                tags.map((tag) => (
                  <label key={tag.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-stone-100">
                    <input
                      type="checkbox"
                      checked={filters.tags.includes(tag.name)}
                      onChange={() => updateField("tags", toggleValue(filters.tags, tag.name))}
                      className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
                    />
                    <span className="text-sm text-stone-700">{tag.name}</span>
                  </label>
                ))
              )}
            </div>
          </FilterDropdown>
        </div>
      </div>

      <div className="mt-6 rounded-[1.75rem] border border-stone-300 bg-stone-50/80 p-4">
        <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Missing fields</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {MISSING_FIELD_OPTIONS.map((option) => (
            <label
              key={option.id}
              className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700"
            >
              <input
                type="checkbox"
                checked={filters.missing.includes(option.id)}
                onChange={() => updateField("missing", toggleValue(filters.missing, option.id))}
                className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={handleApply} className="btn-primary">
          Apply Filters
        </button>
        <button type="button" onClick={handleClear} className="btn-secondary">
          Clear
        </button>
      </div>
    </section>
  );
}
