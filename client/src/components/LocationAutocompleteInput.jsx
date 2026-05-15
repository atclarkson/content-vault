function sanitizeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase();
}

export default function LocationAutocompleteInput({
  label,
  value,
  onChange,
  options,
  placeholder = "",
  id
}) {
  const listId = `${sanitizeId(id || label)}-suggestions`;
  const filteredOptions = Array.isArray(options) ? options.filter(Boolean) : [];

  return (
    <label className="block">
      {label ? <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-stone-500">{label}</span> : null}
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="field"
        placeholder={placeholder}
        list={filteredOptions.length > 0 ? listId : undefined}
      />
      {filteredOptions.length > 0 ? (
        <datalist id={listId}>
          {filteredOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}
