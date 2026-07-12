function createPlaceholders(count) {
  return new Array(count).fill("?").join(", ");
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

function normalizeStringArray(values) {
  if (values === undefined || values === null) {
    return [];
  }

  const list = Array.isArray(values) ? values : [values];

  return [
    ...new Set(
      list
        .map((value) => String(value).trim().toLowerCase())
        .filter(Boolean)
    )
  ];
}

function normalizeOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (value === true || value === "true") {
    return true;
  }

  if (value === false || value === "false") {
    return false;
  }

  throw new Error("Boolean filters must be true or false");
}

function normalizePositiveInteger(value, defaultValue, min, max) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < min || numericValue > max) {
    throw new Error(`Value must be an integer between ${min} and ${max}`);
  }

  return numericValue;
}

function normalizeSort(value, allowedValues, defaultValue) {
  const normalized = normalizeOptionalString(value) || defaultValue;

  if (!allowedValues.includes(normalized)) {
    throw new Error(`Unsupported sort: ${normalized}`);
  }

  return normalized;
}

function normalizeView(value, allowedValues, defaultValue) {
  const normalized = normalizeOptionalString(value) || defaultValue;

  if (!allowedValues.includes(normalized)) {
    throw new Error(`Unsupported view: ${normalized}`);
  }

  return normalized;
}

function tableExists(db, tableName) {
  const row = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ?
    LIMIT 1
  `).get(tableName);

  return Boolean(row);
}

function isMissingTableError(error) {
  return error && typeof error.message === "string" && error.message.includes("no such table:");
}

function isQueryBadRequestError(error) {
  return error.message === "Boolean filters must be true or false"
    || error.message === "ids must be an array of positive integers"
    || error.message.startsWith("Unsupported sort:")
    || error.message.startsWith("Unsupported view:")
    || error.message.startsWith("Value must be an integer between");
}

module.exports = {
  createPlaceholders,
  normalizeOptionalString,
  normalizeOptionalBoolean,
  normalizePositiveInteger,
  normalizeSort,
  normalizeStringArray,
  normalizeView,
  tableExists,
  isMissingTableError,
  isQueryBadRequestError
};
