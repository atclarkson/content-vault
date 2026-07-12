const {
  normalizeOptionalBoolean,
  normalizeOptionalString,
  normalizePositiveInteger,
  normalizeSort,
  normalizeStringArray,
  normalizeView,
  tableExists
} = require("./queryUtils");

function queryJournals(db, options = {}) {
  const normalizedOptions = normalizeJournalQueryOptions(options);

  if (!tableExists(db, "journal_entries")) {
    return {
      items: [],
      total: 0,
      limit: normalizedOptions.limit,
      offset: normalizedOptions.offset
    };
  }

  const filters = buildJournalQueryFilters(normalizedOptions.filters);
  const orderByClause = buildJournalOrderByClause(normalizedOptions.sort);
  const rows = db.prepare(`
    SELECT journal_entries.*
    FROM journal_entries
    ${filters.whereClause}
    ${orderByClause}
    LIMIT ?
    OFFSET ?
  `).all(...filters.params, normalizedOptions.limit, normalizedOptions.offset);
  const totalRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM journal_entries
    ${filters.whereClause}
  `).get(...filters.params);

  return {
    items: rows.map((entry) => mapJournalView(entry, normalizedOptions.view)),
    total: totalRow.count,
    limit: normalizedOptions.limit,
    offset: normalizedOptions.offset
  };
}

function normalizeJournalQueryOptions(options) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const filtersSource = source.filters && typeof source.filters === "object" && !Array.isArray(source.filters)
    ? source.filters
    : source;

  return {
    filters: {
      ids: normalizeIdArray(filtersSource.ids),
      text: normalizeOptionalString(filtersSource.text),
      city: normalizeOptionalString(filtersSource.city),
      country: normalizeOptionalString(filtersSource.country),
      dateFrom: normalizeOptionalString(filtersSource.date_from),
      dateTo: normalizeOptionalString(filtersSource.date_to),
      tagsAny: normalizeStringArray(filtersSource.tags_any),
      tagsAll: normalizeStringArray(filtersSource.tags_all),
      hasLocation: normalizeOptionalBoolean(filtersSource.has_location)
    },
    limit: normalizePositiveInteger(source.limit, 10, 0, 200),
    offset: normalizePositiveInteger(source.offset, 0, 0, 100000),
    sort: normalizeSort(source.sort, ["newest", "oldest"], "newest"),
    view: normalizeView(source.view, ["summary", "full"], "summary")
  };
}

function buildJournalQueryFilters(filters) {
  const conditions = [];
  const params = [];

  if (filters.ids.length > 0) {
    conditions.push(`journal_entries.id IN (${createPlaceholders(filters.ids.length)})`);
    params.push(...filters.ids);
  }

  if (filters.text) {
    const searchPattern = `%${filters.text.toLowerCase()}%`;
    conditions.push(`
      (
        LOWER(COALESCE(journal_entries.title, '')) LIKE ?
        OR LOWER(COALESCE(journal_entries.text, '')) LIKE ?
      )
    `);
    params.push(searchPattern, searchPattern);
  }

  if (filters.city) {
    conditions.push("LOWER(COALESCE(journal_entries.city, '')) LIKE ?");
    params.push(`%${filters.city.toLowerCase()}%`);
  }

  if (filters.country) {
    conditions.push("LOWER(COALESCE(journal_entries.country, '')) LIKE ?");
    params.push(`%${filters.country.toLowerCase()}%`);
  }

  if (filters.dateFrom) {
    conditions.push("journal_entries.entry_date >= ?");
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    conditions.push("journal_entries.entry_date <= ?");
    params.push(filters.dateTo);
  }

  if (filters.hasLocation === true) {
    conditions.push(`
      (
        NULLIF(TRIM(COALESCE(journal_entries.city, '')), '') IS NOT NULL
        OR NULLIF(TRIM(COALESCE(journal_entries.country, '')), '') IS NOT NULL
      )
    `);
  } else if (filters.hasLocation === false) {
    conditions.push(`
      NULLIF(TRIM(COALESCE(journal_entries.city, '')), '') IS NULL
      AND NULLIF(TRIM(COALESCE(journal_entries.country, '')), '') IS NULL
    `);
  }

  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params
  };
}

function buildJournalOrderByClause(sort) {
  if (sort === "oldest") {
    return "ORDER BY journal_entries.entry_date ASC, journal_entries.id ASC";
  }

  return "ORDER BY journal_entries.entry_date DESC, journal_entries.id DESC";
}

function mapJournalView(entry, view) {
  const body = entry.text || "";
  const summary = {
    id: entry.id,
    uuid: entry.day_one_uuid,
    title: entry.title,
    date: entry.entry_date,
    city: entry.city,
    country: entry.country,
    tags: [],
    excerpt: createExcerpt(body, 300)
  };

  if (view === "summary") {
    return summary;
  }

  return {
    ...summary,
    body
  };
}

function createExcerpt(text, maxLength) {
  const plainText = String(text || "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/[`*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (plainText.length <= maxLength) {
    return plainText;
  }

  return `${plainText.slice(0, maxLength).trim()}...`;
}

module.exports = {
  queryJournals
};

function createPlaceholders(count) {
  return new Array(count).fill("?").join(", ");
}

function normalizeIdArray(values) {
  if (values === undefined || values === null) {
    return [];
  }

  if (!Array.isArray(values)) {
    throw new Error("ids must be an array of positive integers");
  }

  const ids = values.map((value) => Number(value));

  if (ids.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error("ids must be an array of positive integers");
  }

  return [...new Set(ids)];
}
