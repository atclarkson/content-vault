import { useState } from "react";
import { createPerson } from "../api";

export default function PeopleSelector({ selectedIds, people, onChange, onPersonCreated }) {
  const [newPersonName, setNewPersonName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  function togglePerson(personId) {
    if (selectedIds.includes(personId)) {
      onChange(selectedIds.filter((id) => id !== personId));
      return;
    }

    onChange([...selectedIds, personId]);
  }

  async function handleCreatePerson() {
    const trimmedName = newPersonName.trim();

    if (!trimmedName || isCreating) {
      return;
    }

    setIsCreating(true);
    setError("");

    try {
      const response = await createPerson(trimmedName);
      const person = response.data;

      onPersonCreated(person);
      onChange([...selectedIds, person.id]);
      setNewPersonName("");
    } catch (createError) {
      setError(createError.message || "Failed to create person");
    } finally {
      setIsCreating(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCreatePerson();
    }
  }

  return (
    <div>
      <div className="max-h-56 space-y-2 overflow-auto rounded-[1.5rem] border border-stone-300 bg-stone-50 p-3">
        {people.length === 0 ? (
          <p className="text-sm text-stone-500">No people in the catalog yet.</p>
        ) : (
          people.map((person) => (
            <label key={person.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-white">
              <input
                type="checkbox"
                checked={selectedIds.includes(person.id)}
                onChange={() => togglePerson(person.id)}
                className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-400"
              />
              <span className="text-sm text-stone-700">{person.name}</span>
            </label>
          ))
        )}
      </div>

      <div className="mt-3">
        <input
          type="text"
          value={newPersonName}
          onChange={(event) => setNewPersonName(event.target.value)}
          onKeyDown={handleKeyDown}
          className="field"
          placeholder="Add person..."
          disabled={isCreating}
        />
        {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      </div>
    </div>
  );
}
