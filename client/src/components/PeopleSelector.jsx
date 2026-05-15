import { useMemo, useState } from "react";
import { createPerson } from "../api";

const PRIMARY_PEOPLE = ["Adam", "Lindsay", "Lily", "Cora", "Harper"];
const QUICK_TAGS = [
  { id: "family", label: "The Family", names: ["Adam", "Lindsay", "Lily", "Cora", "Harper"] },
  { id: "girls", label: "The Girls", names: ["Lily", "Cora", "Harper"] },
  { id: "adam-linds", label: "Adam and Linds", names: ["Adam", "Lindsay"] }
];

export default function PeopleSelector({ selectedIds, people, onChange, onPersonCreated, onNoPeople }) {
  const [personName, setPersonName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const peopleByName = useMemo(() => new Map(
    people.map((person) => [person.name.toLowerCase(), person])
  ), [people]);
  const primaryPeople = useMemo(() => (
    PRIMARY_PEOPLE.map((name) => people.find((person) => person.name === name)).filter(Boolean)
  ), [people]);
  const otherPeople = useMemo(() => (
    people.filter((person) => !PRIMARY_PEOPLE.includes(person.name))
  ), [people]);
  const selectedOtherPeople = useMemo(() => (
    selectedIds
      .map((id) => peopleById.get(id))
      .filter((person) => person && !PRIMARY_PEOPLE.includes(person.name))
      .sort((left, right) => left.name.localeCompare(right.name))
  ), [peopleById, selectedIds]);

  function togglePerson(personId) {
    if (selectedIds.includes(personId)) {
      onChange(selectedIds.filter((id) => id !== personId));
      return;
    }

    onChange([...selectedIds, personId]);
  }

  function applyQuickTag(names) {
    const nextIds = names
      .map((name) => peopleByName.get(name.toLowerCase()))
      .filter(Boolean)
      .map((person) => person.id);

    onChange([...new Set(nextIds)]);
  }

  function addExistingPersonByName(name) {
    const trimmedName = name.trim();

    if (!trimmedName) {
      return false;
    }

    const person = people.find((entry) => entry.name.toLowerCase() === trimmedName.toLowerCase());

    if (!person) {
      return false;
    }

    if (!selectedIds.includes(person.id)) {
      onChange([...selectedIds, person.id]);
    }

    setPersonName("");
    return true;
  }

  async function handleSubmitPerson() {
    const trimmedName = personName.trim();

    if (!trimmedName || isCreating) {
      return;
    }

    setError("");

    if (addExistingPersonByName(trimmedName)) {
      return;
    }

    setIsCreating(true);

    try {
      const response = await createPerson(trimmedName);
      const person = response.data;

      onPersonCreated(person);
      onChange([...selectedIds, person.id]);
      setPersonName("");
    } catch (createError) {
      setError(createError.message || "Failed to create person");
    } finally {
      setIsCreating(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      handleSubmitPerson();
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {primaryPeople.map((person) => {
          const isSelected = selectedIds.includes(person.id);

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

      <div className="mt-3 flex gap-3">
        <div className="flex-1">
          <input
            type="text"
            value={personName}
            onChange={(event) => setPersonName(event.target.value)}
            onKeyDown={handleKeyDown}
            className="field"
            placeholder="Add another person..."
            list="people-selector-suggestions"
            disabled={isCreating}
          />
          <datalist id="people-selector-suggestions">
            {otherPeople.map((person) => (
              <option key={person.id} value={person.name} />
            ))}
          </datalist>
        </div>
        <button
          type="button"
          onClick={handleSubmitPerson}
          disabled={isCreating || !personName.trim()}
          className="btn-secondary"
        >
          {isCreating ? "Adding..." : "Add"}
        </button>
      </div>

      <div className="mt-3">
        <p className="mb-2 text-xs uppercase tracking-[0.2em] text-stone-500">Quick Tags</p>
        <div className="flex flex-wrap gap-2">
          {QUICK_TAGS.map((quickTag) => (
            <button
              key={quickTag.id}
              type="button"
              onClick={() => applyQuickTag(quickTag.names)}
              className="rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-200"
            >
              {quickTag.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              if (onNoPeople) {
                onNoPeople();
                return;
              }

              onChange([]);
            }}
            className="rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-200"
          >
            No People
          </button>
        </div>
      </div>

      {selectedOtherPeople.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedOtherPeople.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => togglePerson(person.id)}
              className="rounded-full border border-stone-300 bg-stone-100 px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-200"
              title="Remove person"
            >
              {person.name} ×
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
