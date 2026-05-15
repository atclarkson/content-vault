import { useEffect, useState } from "react";
import { bulkUpdate, createPerson, getPeople } from "../api";
import LocationAutocompleteInput from "./LocationAutocompleteInput";

const PRIMARY_PEOPLE = ["Adam", "Lindsay", "Lily", "Cora", "Harper"];

function ActionMenu({ title, children }) {
  return (
    <div className="border-t border-stone-200 pt-4">
      <p className="mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">{title}</p>
      {children}
    </div>
  );
}

export default function BulkActionBar({ selectedIds, people, allTags, locationOptions, onAction, onClear }) {
  const [activeAction, setActiveAction] = useState("");
  const [availablePeople, setAvailablePeople] = useState(people);
  const [tagName, setTagName] = useState("");
  const [selectedTagNames, setSelectedTagNames] = useState([]);
  const [selectedPeopleIds, setSelectedPeopleIds] = useState([]);
  const [newPersonName, setNewPersonName] = useState("");
  const [location, setLocation] = useState({
    neighborhood: "",
    city: "",
    region: "",
    country: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setAvailablePeople(people);
  }, [people]);

  useEffect(() => {
    if (activeAction !== "add-person" && activeAction !== "remove-person") {
      return;
    }

    let isActive = true;

    async function loadPeople() {
      try {
        const response = await getPeople();

        if (!isActive) {
          return;
        }

        setAvailablePeople(response?.data || []);
      } catch {
        // Keep the current people snapshot if refresh fails.
      }
    }

    loadPeople();

    return () => {
      isActive = false;
    };
  }, [activeAction]);

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
      setNewPersonName("");
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

  const primaryPeople = PRIMARY_PEOPLE
    .map((name) => availablePeople.find((person) => person.name === name))
    .filter(Boolean);
  const otherPeople = availablePeople.filter((person) => !PRIMARY_PEOPLE.includes(person.name));

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

  async function handleCreatePerson() {
    const trimmedName = newPersonName.trim();

    if (!trimmedName || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const response = await createPerson(trimmedName);
      const person = response?.data;

      if (!person) {
        throw new Error("Failed to create person");
      }

      setAvailablePeople((currentPeople) => {
        const nextPeople = [...currentPeople, person];
        nextPeople.sort((left, right) => left.name.localeCompare(right.name));
        return nextPeople;
      });
      setSelectedPeopleIds((currentIds) => (
        currentIds.includes(person.id) ? currentIds : [...currentIds, person.id]
      ));
      setNewPersonName("");
    } catch (actionError) {
      setError(actionError.message || "Failed to create person");
    } finally {
      setIsSubmitting(false);
    }
  }

  function addExistingPersonByName(name) {
    const trimmedName = name.trim();

    if (!trimmedName) {
      return false;
    }

    const person = availablePeople.find((entry) => entry.name.toLowerCase() === trimmedName.toLowerCase());

    if (!person) {
      return false;
    }

    setSelectedPeopleIds((currentIds) => (
      currentIds.includes(person.id) ? currentIds : [...currentIds, person.id]
    ));
    setNewPersonName("");
    return true;
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-stone-300 bg-white">
      <div className="border-b border-stone-200 px-6 py-5">
        <p className="text-xs uppercase tracking-[0.28em] text-stone-500">Bulk Edit</p>
        <h2 className="mt-2 text-lg font-semibold text-stone-900">
          Editing {selectedIds.size} photo{selectedIds.size === 1 ? "" : "s"}
        </h2>
        <p className="mt-2 text-sm text-stone-500">
          Changes here will be applied to every selected photo.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-wrap gap-3">
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
              <div className="max-h-48 space-y-2 overflow-auto border border-stone-200 bg-stone-50 p-3">
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
              <div className="flex flex-wrap gap-2">
                {primaryPeople.map((person) => {
                  const isSelected = selectedPeopleIds.includes(person.id);

                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => togglePerson(person.id)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                        isSelected
                          ? "border-amber-400 bg-amber-100 text-amber-900"
                          : "border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-50"
                      }`}
                    >
                      {person.name}
                    </button>
                  );
                })}
              </div>
              {selectedPeopleIds.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedPeopleIds
                    .map((id) => availablePeople.find((person) => person.id === id))
                    .filter(Boolean)
                    .filter((person) => !PRIMARY_PEOPLE.includes(person.name))
                    .map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => togglePerson(person.id)}
                        className="rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-200"
                      >
                        {person.name} ×
                      </button>
                    ))}
                </div>
              ) : null}
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
              <div className="mt-3 flex flex-wrap gap-3">
                <input
                  type="text"
                  value={newPersonName}
                  onChange={(event) => setNewPersonName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      if (!addExistingPersonByName(newPersonName)) {
                        handleCreatePerson();
                      }
                    }
                  }}
                  className="field min-w-[240px] flex-1"
                  placeholder="Add another person..."
                  list="bulk-add-person-suggestions"
                />
                <datalist id="bulk-add-person-suggestions">
                  {otherPeople.map((person) => (
                    <option key={person.id} value={person.name} />
                  ))}
                </datalist>
                <button
                  type="button"
                  onClick={() => {
                    if (!addExistingPersonByName(newPersonName)) {
                      handleCreatePerson();
                    }
                  }}
                  disabled={isSubmitting || !newPersonName.trim()}
                  className="btn-secondary"
                >
                  Add New Person
                </button>
              </div>
            </ActionMenu>
          </div>
        ) : null}

        {activeAction === "remove-person" ? (
          <div className="mt-4">
            <ActionMenu title="Remove Person">
              <div className="flex flex-wrap gap-2">
                {primaryPeople.map((person) => {
                  const isSelected = selectedPeopleIds.includes(person.id);

                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => togglePerson(person.id)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                        isSelected
                          ? "border-amber-400 bg-amber-100 text-amber-900"
                          : "border-stone-300 bg-white text-stone-700 hover:border-stone-400 hover:bg-stone-50"
                      }`}
                    >
                      {person.name}
                    </button>
                  );
                })}
              </div>
              {selectedPeopleIds.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedPeopleIds
                    .map((id) => availablePeople.find((person) => person.id === id))
                    .filter(Boolean)
                    .filter((person) => !PRIMARY_PEOPLE.includes(person.name))
                    .map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => togglePerson(person.id)}
                        className="rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-200"
                      >
                        {person.name} ×
                      </button>
                    ))}
                </div>
              ) : null}
              <div className="mt-3">
                <input
                  type="text"
                  value={newPersonName}
                  onChange={(event) => setNewPersonName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === ",") {
                      event.preventDefault();
                      addExistingPersonByName(newPersonName);
                    }
                  }}
                  className="field"
                  placeholder="Select another person to remove..."
                  list="bulk-remove-person-suggestions"
                />
                <datalist id="bulk-remove-person-suggestions">
                  {otherPeople.map((person) => (
                    <option key={person.id} value={person.name} />
                  ))}
                </datalist>
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
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <LocationAutocompleteInput
                  id="bulk-neighborhood"
                  value={location.neighborhood}
                  onChange={(value) => setLocation((current) => ({ ...current, neighborhood: value }))}
                  options={locationOptions?.neighborhoods || []}
                  placeholder="Neighborhood"
                />
                <LocationAutocompleteInput
                  id="bulk-city"
                  value={location.city}
                  onChange={(value) => setLocation((current) => ({ ...current, city: value }))}
                  options={locationOptions?.cities || []}
                  placeholder="City"
                />
                <LocationAutocompleteInput
                  id="bulk-region"
                  value={location.region}
                  onChange={(value) => setLocation((current) => ({ ...current, region: value }))}
                  options={locationOptions?.regions || []}
                  placeholder="Region"
                />
                <LocationAutocompleteInput
                  id="bulk-country"
                  value={location.country}
                  onChange={(value) => setLocation((current) => ({ ...current, country: value }))}
                  options={locationOptions?.countries || []}
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
    </aside>
  );
}
