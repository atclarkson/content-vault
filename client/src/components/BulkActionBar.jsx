import { useState } from "react";
import { bulkUpdate } from "../api";

function ActionMenu({ title, children }) {
  return (
    <div className="rounded-[1.5rem] border border-stone-300 bg-white p-4 shadow-panel">
      <p className="mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">{title}</p>
      {children}
    </div>
  );
}

export default function BulkActionBar({ selectedIds, people, allTags, onAction, onClear }) {
  const [activeAction, setActiveAction] = useState("");
  const [tagName, setTagName] = useState("");
  const [selectedTagNames, setSelectedTagNames] = useState([]);
  const [selectedPeopleIds, setSelectedPeopleIds] = useState([]);
  const [location, setLocation] = useState({
    neighborhood: "",
    city: "",
    region: "",
    country: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (selectedIds.size === 0) {
    return null;
  }

  const ids = Array.from(selectedIds);

  async function submitBulkAction(updates) {
    setIsSubmitting(true);
    setError("");

    try {
      await bulkUpdate(ids, updates);
      onAction(ids);
      setActiveAction("");
      setTagName("");
      setSelectedTagNames([]);
      setSelectedPeopleIds([]);
      setLocation({ neighborhood: "", city: "", region: "", country: "" });
    } catch (actionError) {
      setError(actionError.message || "Bulk update failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleTag(tagNameValue) {
    setSelectedTagNames((currentTags) => (
      currentTags.includes(tagNameValue)
        ? currentTags.filter((currentTag) => currentTag !== tagNameValue)
        : [...currentTags, tagNameValue]
    ));
  }

  function togglePerson(personId) {
    setSelectedPeopleIds((currentIds) => (
      currentIds.includes(personId)
        ? currentIds.filter((currentId) => currentId !== personId)
        : [...currentIds, personId]
    ));
  }

  function buildLocationUpdates() {
    const updates = {};

    if (location.neighborhood.trim()) {
      updates.neighborhood = location.neighborhood.trim();
    }

    if (location.city.trim()) {
      updates.city = location.city.trim();
    }

    if (location.region.trim()) {
      updates.region = location.region.trim();
    }

    if (location.country.trim()) {
      updates.country = location.country.trim();
    }

    return updates;
  }

  return (
    <div className="fixed bottom-6 left-[264px] right-8 z-50">
      <div className="panel border-stone-300 bg-white/95 p-4 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <p className="mr-2 text-sm font-medium text-stone-800">
            {selectedIds.size} photo{selectedIds.size === 1 ? "" : "s"} selected
          </p>

          <button type="button" onClick={() => setActiveAction("add-tag")} className="btn-secondary" disabled={isSubmitting}>
            Add Tag
          </button>
          <button type="button" onClick={() => setActiveAction("remove-tag")} className="btn-secondary" disabled={isSubmitting}>
            Remove Tag
          </button>
          <button type="button" onClick={() => setActiveAction("add-person")} className="btn-secondary" disabled={isSubmitting}>
            Add Person
          </button>
          <button type="button" onClick={() => setActiveAction("remove-person")} className="btn-secondary" disabled={isSubmitting}>
            Remove Person
          </button>
          <button type="button" onClick={() => setActiveAction("set-location")} className="btn-secondary" disabled={isSubmitting}>
            Set Location
          </button>
          <button type="button" onClick={onClear} className="btn-secondary" disabled={isSubmitting}>
            Clear Selection
          </button>
        </div>

        {error ? <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        {activeAction === "add-tag" ? (
          <div className="mt-4">
            <ActionMenu title="Add Tag">
              <div className="flex flex-wrap gap-3">
                <input
                  type="text"
                  value={tagName}
                  onChange={(event) => setTagName(event.target.value)}
                  className="field min-w-[240px] flex-1"
                  placeholder="Tag name"
                />
                <button
                  type="button"
                  onClick={() => submitBulkAction({ add_tags: [tagName.trim()] })}
                  disabled={isSubmitting || !tagName.trim()}
                  className="btn-primary"
                >
                  {isSubmitting ? "Applying..." : "Apply"}
                </button>
              </div>
            </ActionMenu>
          </div>
        ) : null}

        {activeAction === "remove-tag" ? (
          <div className="mt-4">
            <ActionMenu title="Remove Tag">
              <div className="max-h-48 space-y-2 overflow-auto rounded-2xl border border-stone-200 bg-stone-50 p-3">
                {allTags.map((tag) => (
                  <label key={tag.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white">
                    <input
                      type="checkbox"
                      checked={selectedTagNames.includes(tag.name)}
                      onChange={() => toggleTag(tag.name)}
                      className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
                    />
                    <span className="text-sm text-stone-700">{tag.name}</span>
                  </label>
                ))}
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => submitBulkAction({ remove_tags: selectedTagNames })}
                  disabled={isSubmitting || selectedTagNames.length === 0}
                  className="btn-primary"
                >
                  {isSubmitting ? "Applying..." : "Apply"}
                </button>
              </div>
            </ActionMenu>
          </div>
        ) : null}

        {activeAction === "add-person" ? (
          <div className="mt-4">
            <ActionMenu title="Add Person">
              <div className="max-h-48 space-y-2 overflow-auto rounded-2xl border border-stone-200 bg-stone-50 p-3">
                {people.map((person) => (
                  <label key={person.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white">
                    <input
                      type="checkbox"
                      checked={selectedPeopleIds.includes(person.id)}
                      onChange={() => togglePerson(person.id)}
                      className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
                    />
                    <span className="text-sm text-stone-700">{person.name}</span>
                  </label>
                ))}
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => submitBulkAction({ add_people: selectedPeopleIds })}
                  disabled={isSubmitting || selectedPeopleIds.length === 0}
                  className="btn-primary"
                >
                  {isSubmitting ? "Applying..." : "Apply"}
                </button>
              </div>
            </ActionMenu>
          </div>
        ) : null}

        {activeAction === "remove-person" ? (
          <div className="mt-4">
            <ActionMenu title="Remove Person">
              <div className="max-h-48 space-y-2 overflow-auto rounded-2xl border border-stone-200 bg-stone-50 p-3">
                {people.map((person) => (
                  <label key={person.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white">
                    <input
                      type="checkbox"
                      checked={selectedPeopleIds.includes(person.id)}
                      onChange={() => togglePerson(person.id)}
                      className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
                    />
                    <span className="text-sm text-stone-700">{person.name}</span>
                  </label>
                ))}
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => submitBulkAction({ remove_people: selectedPeopleIds })}
                  disabled={isSubmitting || selectedPeopleIds.length === 0}
                  className="btn-primary"
                >
                  {isSubmitting ? "Applying..." : "Apply"}
                </button>
              </div>
            </ActionMenu>
          </div>
        ) : null}

        {activeAction === "set-location" ? (
          <div className="mt-4">
            <ActionMenu title="Set Location">
              <div className="grid gap-3 md:grid-cols-3">
                <input
                  type="text"
                  value={location.neighborhood}
                  onChange={(event) => setLocation((current) => ({ ...current, neighborhood: event.target.value }))}
                  className="field"
                  placeholder="Neighborhood"
                />
                <input
                  type="text"
                  value={location.city}
                  onChange={(event) => setLocation((current) => ({ ...current, city: event.target.value }))}
                  className="field"
                  placeholder="City"
                />
                <input
                  type="text"
                  value={location.region}
                  onChange={(event) => setLocation((current) => ({ ...current, region: event.target.value }))}
                  className="field"
                  placeholder="Region"
                />
                <input
                  type="text"
                  value={location.country}
                  onChange={(event) => setLocation((current) => ({ ...current, country: event.target.value }))}
                  className="field"
                  placeholder="Country"
                />
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => submitBulkAction(buildLocationUpdates())}
                  disabled={
                    isSubmitting
                    || Object.keys(buildLocationUpdates()).length === 0
                  }
                  className="btn-primary"
                >
                  {isSubmitting ? "Applying..." : "Apply"}
                </button>
              </div>
            </ActionMenu>
          </div>
        ) : null}
      </div>
    </div>
  );
}
