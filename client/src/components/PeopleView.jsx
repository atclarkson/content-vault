import { useEffect, useMemo, useRef, useState } from "react";
import { createPerson, deletePerson, getPhotos, getVideos, updatePerson } from "../api";

export default function PeopleView({ people, refreshPeople }) {
  const [newPersonName, setNewPersonName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [expandedPersonId, setExpandedPersonId] = useState(null);
  const [error, setError] = useState("");

  async function handleCreatePerson(event) {
    event.preventDefault();

    if (!newPersonName.trim()) {
      return;
    }

    setIsCreating(true);
    setError("");

    try {
      await createPerson(newPersonName.trim());
      setNewPersonName("");
      await refreshPeople();
    } catch (createError) {
      setError(createError.message || "Failed to create person");
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <section className="panel flex h-full min-h-0 flex-col overflow-hidden p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.28em] text-stone-500">People</p>
        <h2 className="mt-2 text-2xl font-semibold text-stone-900">People</h2>
      </div>

      {error ? (
        <div className="mb-4 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleCreatePerson} className="mb-6 border border-stone-300 bg-stone-50 p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-stone-500">Add Person</p>
        <div className="mt-4 flex gap-3">
          <input
            type="text"
            value={newPersonName}
            onChange={(event) => setNewPersonName(event.target.value)}
            className="field flex-1"
            placeholder="Name"
          />
          <button type="submit" disabled={isCreating || !newPersonName.trim()} className="btn-primary">
            {isCreating ? "Adding..." : "Add Person"}
          </button>
        </div>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="divide-y divide-stone-200 border border-stone-300 bg-white">
          {people.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              refreshPeople={refreshPeople}
              isExpanded={expandedPersonId === person.id}
              onExpand={setExpandedPersonId}
              onCollapse={() => setExpandedPersonId((currentId) => (currentId === person.id ? null : currentId))}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function PersonRow({ person, refreshPeople, isExpanded, onExpand, onCollapse }) {
  const [form, setForm] = useState(() => buildFormState(person));
  const [isSaving, setIsSaving] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");
  const rowRef = useRef(null);
  const lastSavedRef = useRef("");
  const timeoutRef = useRef(null);
  const savePromiseRef = useRef(null);

  useEffect(() => {
    const nextForm = buildFormState(person);
    setForm(nextForm);
    lastSavedRef.current = JSON.stringify(nextForm);
    setSaveState("idle");
    setError("");
  }, [person]);

  useEffect(() => {
    if (!isExpanded) {
      return undefined;
    }

    function handlePointerDown(event) {
      const nextRow = event.target.closest("[data-person-row-id]");

      if (nextRow) {
        const nextPersonId = Number(nextRow.getAttribute("data-person-row-id"));

        if (Number.isInteger(nextPersonId) && nextPersonId !== person.id) {
          onExpand(nextPersonId);
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

  const serializedForm = useMemo(() => JSON.stringify(form), [form]);

  async function persistChanges() {
    if (serializedForm === lastSavedRef.current) {
      return true;
    }

    if (savePromiseRef.current) {
      return savePromiseRef.current;
    }

    setIsSaving(true);
    setSaveState("saving");
    setError("");

    const savePromise = updatePerson(person.id, form)
      .then(async () => {
        lastSavedRef.current = serializedForm;
        setSaveState("saved");
        await refreshPeople();
        return true;
      })
      .catch((saveError) => {
        setError(saveError.message || "Failed to save person");
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
    if (!isExpanded || serializedForm === lastSavedRef.current) {
      return undefined;
    }

    setSaveState("dirty");

    timeoutRef.current = window.setTimeout(() => {
      persistChanges();
    }, 800);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [isExpanded, serializedForm]);

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
        Array.isArray(photo.people) && photo.people.some((item) => item.id === person.id)
      )).length;
      const videoCount = (videosResponse?.data || []).filter((video) => (
        Array.isArray(video.people) && video.people.some((item) => item.id === person.id)
      )).length;

      if (!window.confirm(`This person is tagged in ${photoCount} photos and ${videoCount} videos. Are you sure?`)) {
        setIsDeleting(false);
        return;
      }

      await deletePerson(person.id);
      await refreshPeople();
      onCollapse();
    } catch (deleteError) {
      setError(deleteError.message || "Failed to delete person");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <article ref={rowRef} data-person-row-id={person.id} className="bg-white">
      <button
        type="button"
        onClick={() => (isExpanded ? onCollapse() : onExpand(person.id))}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-stone-50"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-stone-900">{person.name}</p>
          <p className="mt-1 text-xs text-stone-500">
            {saveState === "saving" && "Saving..."}
            {saveState === "saved" && "Saved"}
            {saveState === "dirty" && "Waiting to save..."}
            {saveState === "error" && "Save failed"}
            {saveState === "idle" && (person.birthday ? `Birthday ${person.birthday}` : "No birthday set")}
          </p>
        </div>

        <span className="btn-secondary px-4 py-2 text-sm">
          {isExpanded ? "Done" : "Edit"}
        </span>
      </button>

      {isExpanded ? (
        <div className="border-t border-stone-200 px-5 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name">
              <input type="text" value={form.name} onChange={(event) => updateForm(setForm, "name", event.target.value)} className="field" />
            </Field>
            <Field label="Birthday">
              <input type="date" value={form.birthday} onChange={(event) => updateForm(setForm, "birthday", event.target.value)} className="field" />
            </Field>
            <Field label="YouTube Channel">
              <input type="text" value={form.youtube_channel} onChange={(event) => updateForm(setForm, "youtube_channel", event.target.value)} className="field" />
            </Field>
            <Field label="Instagram">
              <input type="text" value={form.instagram} onChange={(event) => updateForm(setForm, "instagram", event.target.value)} className="field" />
            </Field>
            <Field label="Website" className="md:col-span-2">
              <input type="text" value={form.website} onChange={(event) => updateForm(setForm, "website", event.target.value)} className="field" />
            </Field>
            <Field label="Notes" className="md:col-span-2">
              <textarea value={form.notes} onChange={(event) => updateForm(setForm, "notes", event.target.value)} className="field min-h-[120px] resize-y" />
            </Field>
          </div>

          <div className="mt-4 flex justify-end">
            <button type="button" onClick={handleDelete} disabled={isDeleting || isSaving} className="btn-secondary">
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </div>

          {error ? <div className="mt-4 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        </div>
      ) : null}
    </article>
  );
}

function Field({ label, className = "", children }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-stone-500">{label}</span>
      {children}
    </label>
  );
}

function buildFormState(person) {
  return {
    name: person.name || "",
    birthday: person.birthday ? String(person.birthday).slice(0, 10) : "",
    notes: person.notes || "",
    youtube_channel: person.youtube_channel || "",
    instagram: person.instagram || "",
    website: person.website || ""
  };
}

function updateForm(setForm, field, value) {
  setForm((currentForm) => ({
    ...currentForm,
    [field]: value
  }));
}
