import { useEffect, useMemo, useState } from "react";
import { bulkUpdate, createPerson, deletePhoto, getDestinations, getPeople } from "../api";
import LocationAutocompleteInput from "./LocationAutocompleteInput";

const PRIMARY_PEOPLE = ["Adam", "Lindsay", "Lily", "Cora", "Harper"];
let cachedDestinations = null;
let destinationsRequest = null;

function ActionMenu({ title, children }) {
  return (
    <div className="border-t border-stone-200 pt-4">
      <p className="mb-3 text-xs uppercase tracking-[0.24em] text-stone-500">{title}</p>
      {children}
    </div>
  );
}

const ACTION_BUTTONS = {
  "assign-destination": { label: "Assign Destination", icon: "ti ti-map-pin", className: "btn-secondary" },
  "add-tag": { label: "Add Tag", icon: "ti ti-tag-plus", className: "btn-secondary" },
  "remove-tag": { label: "Remove Tag", icon: "ti ti-tag-minus", className: "btn-secondary" },
  "add-person": { label: "Add Person", icon: "ti ti-user-plus", className: "btn-secondary" },
  "remove-person": { label: "Remove Person", icon: "ti ti-user-minus", className: "btn-secondary" },
  "set-location": { label: "Set Location", icon: "ti ti-map-2", className: "btn-secondary" },
  "delete-photos": {
    label: "Delete Selected",
    icon: "ti ti-trash",
    className: "inline-flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
  },
  clear: { label: "Clear Selection", icon: "ti ti-x", className: "btn-secondary" }
};

function BulkToolbarButton({ actionKey, isActive, onClick }) {
  const action = ACTION_BUTTONS[actionKey];

  if (!action) {
    return null;
  }

  const isDelete = actionKey === "delete-photos";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 ${
        isDelete ? action.className : "btn-secondary"
      } ${isActive && !isDelete ? "bg-stone-900 text-stone-50 hover:bg-stone-900 hover:text-stone-50" : ""}`}
    >
      <i className={`${action.icon} text-base`} aria-hidden="true" />
      <span>{action.label}</span>
    </button>
  );
}

function normalizeIds(selectedIds) {
  return Array.from(selectedIds || []);
}

function formatDestinationRange(dateStart, dateEnd) {
  if (!dateStart || !dateEnd) {
    return "";
  }

  const start = new Date(dateStart);
  const end = new Date(dateEnd);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "";
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

function getDestinationLabel(destination) {
  return `${destination.city}, ${destination.country}`;
}

function buildDestinationUpdates(destination) {
  const updates = {};

  if (destination?.city?.trim()) {
    updates.city = destination.city.trim();
  }

  if (destination?.country?.trim()) {
    updates.country = destination.country.trim();
  }

  if (typeof destination?.region === "string" && destination.region.trim()) {
    updates.region = destination.region.trim();
  }

  return updates;
}

function getDestinationTimestamp(destination) {
  const candidates = [destination?.date_start, destination?.date_end, destination?.created_at];

  for (const value of candidates) {
    if (!value) {
      continue;
    }

    const timestamp = new Date(value).getTime();

    if (!Number.isNaN(timestamp)) {
      return timestamp;
    }
  }

  return 0;
}

function sortDestinations(destinations) {
  const groupedDestinations = new Map();

  destinations.forEach((destination, index) => {
    const key = `${destination.city}__${destination.country}`;
    const group = groupedDestinations.get(key) || [];
    group.push({ destination, index });
    groupedDestinations.set(key, group);
  });

  return [...groupedDestinations.values()]
    .map((group) => group.sort((left, right) => (
      getDestinationTimestamp(right.destination) - getDestinationTimestamp(left.destination)
      || left.index - right.index
    )))
    .sort((leftGroup, rightGroup) => (
      getDestinationTimestamp(rightGroup[0].destination) - getDestinationTimestamp(leftGroup[0].destination)
      || leftGroup[0].index - rightGroup[0].index
    ))
    .flat()
    .map((entry) => entry.destination);
}

function useAvailablePeople(people, shouldRefresh = false) {
  const [availablePeople, setAvailablePeople] = useState(people);

  useEffect(() => {
    setAvailablePeople(people);
  }, [people]);

  useEffect(() => {
    if (!shouldRefresh) {
      return undefined;
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
  }, [shouldRefresh]);

  return [availablePeople, setAvailablePeople];
}

function PersonSelectionSection({
  selectedPeopleIds,
  availablePeople,
  newPersonName,
  setNewPersonName,
  togglePerson,
  isSubmitting,
  addExistingPersonByName,
  handleCreatePerson,
  createButtonLabel
}) {
  const primaryPeople = useMemo(
    () => PRIMARY_PEOPLE
      .map((name) => availablePeople.find((person) => person.name === name))
      .filter(Boolean),
    [availablePeople]
  );
  const otherPeople = useMemo(
    () => availablePeople.filter((person) => !PRIMARY_PEOPLE.includes(person.name)),
    [availablePeople]
  );

  return (
    <>
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
          list={`bulk-person-suggestions-${createButtonLabel.replace(/\s+/g, "-").toLowerCase()}`}
        />
        <datalist id={`bulk-person-suggestions-${createButtonLabel.replace(/\s+/g, "-").toLowerCase()}`}>
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
          {createButtonLabel}
        </button>
      </div>
    </>
  );
}

export function AddTagAction({ selectedIds, onDone, onClearSelection, inline = false }) {
  const [tagName, setTagName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const ids = normalizeIds(selectedIds);

  async function handleSubmit() {
    const trimmedTag = tagName.trim();

    if (!trimmedTag || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await bulkUpdate(ids, { add_tags: [trimmedTag] });
      setTagName("");
      onDone?.(ids);
      onClearSelection?.();
    } catch (actionError) {
      setError(actionError.message || "Bulk update failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  const content = (
    <>
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
          onClick={handleSubmit}
          disabled={isSubmitting || !tagName.trim()}
          className="btn-primary"
        >
          {isSubmitting ? "Applying..." : "Apply"}
        </button>
      </div>

      {error ? <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </>
  );

  if (inline) {
    return content;
  }

  return <ActionMenu title="Add Tag">{content}</ActionMenu>;
}

export function RemoveTagAction({ selectedIds, allTags, onDone, onClearSelection, inline = false }) {
  const [selectedTagNames, setSelectedTagNames] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const ids = normalizeIds(selectedIds);

  function toggleTag(tagName) {
    setSelectedTagNames((currentTags) => (
      currentTags.includes(tagName)
        ? currentTags.filter((currentTag) => currentTag !== tagName)
        : [...currentTags, tagName]
    ));
  }

  async function handleSubmit() {
    if (selectedTagNames.length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await bulkUpdate(ids, { remove_tags: selectedTagNames });
      setSelectedTagNames([]);
      onDone?.(ids);
      onClearSelection?.();
    } catch (actionError) {
      setError(actionError.message || "Bulk update failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  const content = (
    <>
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
          onClick={handleSubmit}
          disabled={isSubmitting || selectedTagNames.length === 0}
          className="btn-primary"
        >
          {isSubmitting ? "Applying..." : "Apply"}
        </button>
      </div>

      {error ? <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </>
  );

  if (inline) {
    return content;
  }

  return <ActionMenu title="Remove Tag">{content}</ActionMenu>;
}

export function AddPersonAction({ selectedIds, people, onDone, onClearSelection, inline = false }) {
  const [availablePeople, setAvailablePeople] = useAvailablePeople(people, true);
  const [selectedPeopleIds, setSelectedPeopleIds] = useState([]);
  const [newPersonName, setNewPersonName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const ids = normalizeIds(selectedIds);

  function togglePerson(personId) {
    setSelectedPeopleIds((currentIds) => (
      currentIds.includes(personId)
        ? currentIds.filter((currentId) => currentId !== personId)
        : [...currentIds, personId]
    ));
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

  async function handleSubmit() {
    if (selectedPeopleIds.length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await bulkUpdate(ids, { add_people: selectedPeopleIds });
      setSelectedPeopleIds([]);
      setNewPersonName("");
      onDone?.(ids);
      onClearSelection?.();
    } catch (actionError) {
      setError(actionError.message || "Bulk update failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  const content = (
    <>
      <PersonSelectionSection
        selectedPeopleIds={selectedPeopleIds}
        availablePeople={availablePeople}
        newPersonName={newPersonName}
        setNewPersonName={setNewPersonName}
        togglePerson={togglePerson}
        isSubmitting={isSubmitting}
        addExistingPersonByName={addExistingPersonByName}
        handleCreatePerson={handleCreatePerson}
        createButtonLabel="Add New Person"
      />
      <div className="mt-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || selectedPeopleIds.length === 0}
          className="btn-primary"
        >
          {isSubmitting ? "Applying..." : "Apply"}
        </button>
      </div>

      {error ? <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </>
  );

  if (inline) {
    return content;
  }

  return <ActionMenu title="Add Person">{content}</ActionMenu>;
}

export function RemovePersonAction({ selectedIds, people, onDone, onClearSelection, inline = false }) {
  const [availablePeople] = useAvailablePeople(people, true);
  const [selectedPeopleIds, setSelectedPeopleIds] = useState([]);
  const [newPersonName, setNewPersonName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const ids = normalizeIds(selectedIds);

  function togglePerson(personId) {
    setSelectedPeopleIds((currentIds) => (
      currentIds.includes(personId)
        ? currentIds.filter((currentId) => currentId !== personId)
        : [...currentIds, personId]
    ));
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

  async function handleSubmit() {
    if (selectedPeopleIds.length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await bulkUpdate(ids, { remove_people: selectedPeopleIds });
      setSelectedPeopleIds([]);
      setNewPersonName("");
      onDone?.(ids);
      onClearSelection?.();
    } catch (actionError) {
      setError(actionError.message || "Bulk update failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  const content = (
    <>
      <PersonSelectionSection
        selectedPeopleIds={selectedPeopleIds}
        availablePeople={availablePeople}
        newPersonName={newPersonName}
        setNewPersonName={setNewPersonName}
        togglePerson={togglePerson}
        isSubmitting={isSubmitting}
        addExistingPersonByName={addExistingPersonByName}
        handleCreatePerson={() => {}}
        createButtonLabel="Add Existing"
      />
      <div className="mt-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || selectedPeopleIds.length === 0}
          className="btn-primary"
        >
          {isSubmitting ? "Applying..." : "Apply"}
        </button>
      </div>

      {error ? <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </>
  );

  if (inline) {
    return content;
  }

  return <ActionMenu title="Remove Person">{content}</ActionMenu>;
}

export function SetLocationAction({ selectedIds, locationOptions, onDone, onClearSelection, inline = false }) {
  const [location, setLocation] = useState({
    neighborhood: "",
    city: "",
    region: "",
    country: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const ids = normalizeIds(selectedIds);

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

  async function handleSubmit() {
    const updates = buildLocationUpdates();

    if (Object.keys(updates).length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await bulkUpdate(ids, updates);
      setLocation({ neighborhood: "", city: "", region: "", country: "" });
      onDone?.(ids);
      onClearSelection?.();
    } catch (actionError) {
      setError(actionError.message || "Bulk update failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  const content = (
    <>
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
          onClick={handleSubmit}
          disabled={isSubmitting || Object.keys(buildLocationUpdates()).length === 0}
          className="btn-primary"
        >
          {isSubmitting ? "Applying..." : "Apply"}
        </button>
      </div>

      {error ? <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </>
  );

  if (inline) {
    return content;
  }

  return <ActionMenu title="Set Location">{content}</ActionMenu>;
}

export function DeletePhotosAction({ selectedIds, onDone, onClearSelection, onClose, inline = false }) {
  const ids = normalizeIds(selectedIds);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (ids.length === 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await Promise.all(ids.map((photoId) => deletePhoto(photoId)));
      onDone?.(ids);
      onClearSelection?.();
      onClose?.();
    } catch (actionError) {
      setError(actionError.message || "Failed to delete photos");
    } finally {
      setIsSubmitting(false);
    }
  }

  const content = (
    <>
      <p className="text-sm text-stone-600">
        Delete {ids.length} photo{ids.length === 1 ? "" : "s"}? They will be moved to trash and can be restored.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || ids.length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <i className="ti ti-trash text-base" aria-hidden="true" />
          {isSubmitting ? "Deleting..." : "Delete Selected"}
        </button>
        {onClose ? (
          <button type="button" onClick={onClose} disabled={isSubmitting} className="btn-secondary">
            Cancel
          </button>
        ) : null}
      </div>

      {error ? <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </>
  );

  if (inline) {
    return content;
  }

  return <ActionMenu title="Delete Photos">{content}</ActionMenu>;
}

export function AssignDestinationAction({
  selectedIds,
  onDone,
  onClearSelection,
  onClose,
  inline = false,
  stickyConfirm = false
}) {
  const ids = normalizeIds(selectedIds);
  const [destinations, setDestinations] = useState(() => cachedDestinations || []);
  const [isLoading, setIsLoading] = useState(() => !cachedDestinations);
  const [loadError, setLoadError] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [pendingDestination, setPendingDestination] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let isActive = true;

    async function loadDestinations() {
      if (cachedDestinations) {
        setDestinations(cachedDestinations);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setLoadError("");

      try {
        if (!destinationsRequest) {
          destinationsRequest = getDestinations()
            .then((response) => {
              const nextDestinations = sortDestinations(
                (response?.data || []).filter((destination) => (
                  destination?.city?.trim() && destination?.country?.trim()
                ))
              );
              cachedDestinations = nextDestinations;
              return nextDestinations;
            })
            .finally(() => {
              destinationsRequest = null;
            });
        }

        const nextDestinations = await destinationsRequest;

        if (!isActive) {
          return;
        }

        setDestinations(nextDestinations);
      } catch (error) {
        if (!isActive) {
          return;
        }

        cachedDestinations = null;
        setLoadError(error.message || "Failed to load destinations");
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    loadDestinations();

    return () => {
      isActive = false;
    };
  }, [reloadNonce]);

  const filteredDestinations = useMemo(() => {
    const query = searchValue.trim().toLowerCase();

    if (!query) {
      return destinations;
    }

    return destinations.filter((destination) => {
      const city = destination.city.toLowerCase();
      const country = destination.country.toLowerCase();
      const combined = `${city}, ${country}`;
      return city.includes(query) || country.includes(query) || combined.includes(query);
    });
  }, [destinations, searchValue]);

  async function handleApply() {
    const updates = buildDestinationUpdates(pendingDestination);

    if (!pendingDestination || Object.keys(updates).length < 2 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      await bulkUpdate(ids, updates);
      setSearchValue("");
      setPendingDestination(null);
      onDone?.(ids);
      onClearSelection?.();
      onClose?.();
    } catch (error) {
      setSubmitError(error.message || "Bulk update failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleRetry() {
    cachedDestinations = null;
    destinationsRequest = null;
    setDestinations([]);
    setLoadError("");
    setIsLoading(true);
    setReloadNonce((currentValue) => currentValue + 1);
  }

  const confirmContent = pendingDestination ? (
    <div
      className={
        stickyConfirm
          ? "sticky bottom-0 -mx-5 border-t border-stone-200 bg-white px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4"
          : "rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4"
      }
    >
      <p className="text-sm font-medium text-stone-900">
        Assign {ids.length} photo{ids.length === 1 ? "" : "s"} to {getDestinationLabel(pendingDestination)}?
      </p>
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={() => {
            setPendingDestination(null);
            setSubmitError("");
          }}
          disabled={isSubmitting}
          className="btn-secondary flex-1"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={isSubmitting}
          className="btn-primary flex-1"
        >
          {isSubmitting ? "Applying..." : "Apply"}
        </button>
      </div>
      {submitError ? <div className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</div> : null}
    </div>
  ) : null;

  const content = (
    <div className="space-y-4">
      <div>
        <input
          type="text"
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          className="field w-full"
          placeholder="Search destinations"
        />
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
          <p>{loadError}</p>
          <button type="button" onClick={handleRetry} className="btn-secondary mt-3">
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
          Loading destinations...
        </div>
      ) : filteredDestinations.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-600">
          {destinations.length === 0 ? "No destinations found." : "No destinations match that search."}
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-2xl border border-stone-200 bg-white">
          {filteredDestinations.map((destination) => {
            const isPending = pendingDestination?.id === destination.id;
            const dateRange = formatDestinationRange(destination.date_start, destination.date_end);

            return (
              <button
                key={destination.id}
                type="button"
                onClick={() => {
                  setPendingDestination(destination);
                  setSubmitError("");
                }}
                className={`flex w-full items-start justify-between gap-4 border-b border-stone-200 px-4 py-3 text-left last:border-b-0 ${
                  isPending ? "bg-amber-50" : "hover:bg-stone-50"
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-stone-900">{getDestinationLabel(destination)}</span>
                  {dateRange ? <span className="mt-1 block text-xs text-stone-500">{dateRange}</span> : null}
                </span>
                {isPending ? <span className="text-xs font-medium uppercase tracking-[0.2em] text-amber-700">Selected</span> : null}
              </button>
            );
          })}
        </div>
      )}

      {!stickyConfirm ? confirmContent : null}
      {stickyConfirm ? confirmContent : null}
    </div>
  );

  if (inline) {
    return content;
  }

  return <ActionMenu title="Assign Destination">{content}</ActionMenu>;
}

export default function BulkActionBar({ selectedIds, people, allTags, locationOptions, onAction, onClear }) {
  const [activeAction, setActiveAction] = useState("");

  if (selectedIds.size === 0) {
    return null;
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
          {["assign-destination", "add-tag", "remove-tag", "add-person", "remove-person", "set-location", "delete-photos"].map((actionKey) => (
            <BulkToolbarButton
              key={actionKey}
              actionKey={actionKey}
              isActive={activeAction === actionKey}
              onClick={() => setActiveAction(actionKey)}
            />
          ))}
          <BulkToolbarButton actionKey="clear" isActive={false} onClick={onClear} />
        </div>

        {activeAction === "assign-destination" ? (
          <div className="mt-4">
            <AssignDestinationAction
              selectedIds={selectedIds}
              onDone={onAction}
              onClose={() => setActiveAction("")}
            />
          </div>
        ) : null}

        {activeAction === "add-tag" ? (
          <div className="mt-4">
            <AddTagAction selectedIds={selectedIds} onDone={onAction} />
          </div>
        ) : null}

        {activeAction === "remove-tag" ? (
          <div className="mt-4">
            <RemoveTagAction selectedIds={selectedIds} allTags={allTags} onDone={onAction} />
          </div>
        ) : null}

        {activeAction === "add-person" ? (
          <div className="mt-4">
            <AddPersonAction selectedIds={selectedIds} people={people} onDone={onAction} />
          </div>
        ) : null}

        {activeAction === "remove-person" ? (
          <div className="mt-4">
            <RemovePersonAction selectedIds={selectedIds} people={people} onDone={onAction} />
          </div>
        ) : null}

        {activeAction === "set-location" ? (
          <div className="mt-4">
            <SetLocationAction
              selectedIds={selectedIds}
              locationOptions={locationOptions}
              onDone={onAction}
            />
          </div>
        ) : null}

        {activeAction === "delete-photos" ? (
          <div className="mt-4">
            <DeletePhotosAction
              selectedIds={selectedIds}
              onDone={onAction}
              onClearSelection={onClear}
              onClose={() => setActiveAction("")}
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}
