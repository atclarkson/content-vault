function queryPhotos(db, options = {}) {
  const normalizedOptions = normalizePhotoQueryOptions(options);
  const filters = buildPhotoQueryFilters(normalizedOptions.filters);
  const orderByClause = buildPhotoOrderByClause(normalizedOptions.sort);

  const rows = db.prepare(`
    SELECT photos.*
    FROM photos
    ${filters.whereClause}
    ${orderByClause}
    LIMIT ?
    OFFSET ?
  `).all(...filters.params, normalizedOptions.limit, normalizedOptions.offset);

  const totalRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM photos
    ${filters.whereClause}
  `).get(...filters.params);

  const items = attachPeopleAndTags(db, rows).map((photo) => mapPhotoView(photo, normalizedOptions.view));

  return {
    items,
    total: totalRow.count,
    limit: normalizedOptions.limit,
    offset: normalizedOptions.offset,
    applied: normalizedOptions
  };
}

function normalizePhotoQueryOptions(options) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const filtersSource = source.filters && typeof source.filters === "object" && !Array.isArray(source.filters)
    ? source.filters
    : source;

  return {
    filters: normalizePhotoQueryFilters(filtersSource),
    sort: normalizePhotoSort(source.sort),
    view: normalizePhotoView(source.view),
    limit: normalizePositiveInteger(source.limit, 50, 0, 200),
    offset: normalizePositiveInteger(source.offset, 0, 0, 100000)
  };
}

function normalizePhotoQueryFilters(filters) {
  const source = filters && typeof filters === "object" && !Array.isArray(filters) ? filters : {};

  return {
    ids: normalizeIdArray(source.ids),
    text: normalizeOptionalString(source.text),
    peopleAll: normalizeStringArray(source.people_all),
    peopleAny: normalizeStringArray(source.people_any),
    tagsAll: normalizeStringArray(source.tags_all),
    tagsAny: normalizeStringArray(source.tags_any),
    city: normalizeOptionalString(source.city),
    country: normalizeOptionalString(source.country),
    orientation: normalizePhotoOrientation(source.orientation),
    minWidth: normalizePositiveInteger(source.min_width, null, 0, 100000),
    minHeight: normalizePositiveInteger(source.min_height, null, 0, 100000),
    dateFrom: normalizeOptionalString(source.date_from),
    dateTo: normalizeOptionalString(source.date_to),
    processingStatus: normalizeOptionalString(source.processing_status),
    geoStatus: normalizeOptionalString(source.geo_status),
    missing: normalizeStringArray(source.missing),
    hasPeople: normalizeOptionalBoolean(source.has_people),
    hasTags: normalizeOptionalBoolean(source.has_tags),
    hasLocation: normalizeOptionalBoolean(source.has_location),
    includeDeleted: normalizeOptionalBoolean(source.include_deleted) === true
  };
}

function buildPhotoQueryFilters(filters) {
  const conditions = [];
  const params = [];

  if (!filters.includeDeleted) {
    conditions.push("photos.deleted_at IS NULL");
  }

  if (filters.ids.length > 0) {
    const placeholders = createPlaceholders(filters.ids.length);
    conditions.push(`photos.id IN (${placeholders})`);
    params.push(...filters.ids);
  }

  if (filters.text) {
    const searchPattern = `%${filters.text.toLowerCase()}%`;
    conditions.push(`
      (
        LOWER(COALESCE(photos.title, '')) LIKE ?
        OR LOWER(COALESCE(photos.description, '')) LIKE ?
        OR LOWER(COALESCE(photos.ai_caption, '')) LIKE ?
        OR LOWER(COALESCE(photos.alt_text, '')) LIKE ?
        OR LOWER(COALESCE(photos.notes_for_ai, '')) LIKE ?
        OR LOWER(COALESCE(photos.city, '')) LIKE ?
        OR LOWER(COALESCE(photos.country, '')) LIKE ?
        OR EXISTS (
          SELECT 1
          FROM photo_tags
          INNER JOIN tags ON tags.id = photo_tags.tag_id
          WHERE photo_tags.photo_id = photos.id
            AND LOWER(tags.name) LIKE ?
        )
        OR EXISTS (
          SELECT 1
          FROM photo_people
          INNER JOIN people ON people.id = photo_people.person_id
          WHERE photo_people.photo_id = photos.id
            AND LOWER(people.name) LIKE ?
        )
      )
    `);
    params.push(
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern
    );
  }

  addNamedEntityFilter({
    filters,
    conditions,
    params,
    allValues: filters.peopleAll,
    anyValues: filters.peopleAny,
    tableName: "photo_people",
    joinedTableName: "people",
    joinedColumnName: "name",
    foreignKeyName: "person_id"
  });

  addNamedEntityFilter({
    filters,
    conditions,
    params,
    allValues: filters.tagsAll,
    anyValues: filters.tagsAny,
    tableName: "photo_tags",
    joinedTableName: "tags",
    joinedColumnName: "name",
    foreignKeyName: "tag_id"
  });

  if (filters.city) {
    conditions.push("LOWER(COALESCE(photos.city, '')) LIKE ?");
    params.push(`%${filters.city.toLowerCase()}%`);
  }

  if (filters.country) {
    conditions.push("LOWER(COALESCE(photos.country, '')) LIKE ?");
    params.push(`%${filters.country.toLowerCase()}%`);
  }

  if (filters.orientation || filters.minWidth !== null || filters.minHeight !== null) {
    conditions.push("photos.width IS NOT NULL");
    conditions.push("photos.height IS NOT NULL");
  }

  if (filters.orientation === "landscape") {
    conditions.push("photos.width > photos.height");
  } else if (filters.orientation === "portrait") {
    conditions.push("photos.width < photos.height");
  } else if (filters.orientation === "square") {
    conditions.push("photos.width = photos.height");
  }

  if (filters.minWidth !== null) {
    conditions.push("photos.width >= ?");
    params.push(filters.minWidth);
  }

  if (filters.minHeight !== null) {
    conditions.push("photos.height >= ?");
    params.push(filters.minHeight);
  }

  if (filters.dateFrom) {
    conditions.push("photos.captured_at >= ?");
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    conditions.push("photos.captured_at <= ?");
    params.push(filters.dateTo);
  }

  if (filters.processingStatus) {
    conditions.push("photos.processing_status = ?");
    params.push(filters.processingStatus);
  }

  if (filters.geoStatus) {
    conditions.push("photos.geo_status = ?");
    params.push(filters.geoStatus);
  }

  if (filters.hasPeople === true) {
    conditions.push("EXISTS (SELECT 1 FROM photo_people WHERE photo_people.photo_id = photos.id)");
  } else if (filters.hasPeople === false) {
    conditions.push("NOT EXISTS (SELECT 1 FROM photo_people WHERE photo_people.photo_id = photos.id)");
  }

  if (filters.hasTags === true) {
    conditions.push("EXISTS (SELECT 1 FROM photo_tags WHERE photo_tags.photo_id = photos.id)");
  } else if (filters.hasTags === false) {
    conditions.push("NOT EXISTS (SELECT 1 FROM photo_tags WHERE photo_tags.photo_id = photos.id)");
  }

  if (filters.hasLocation === true) {
    conditions.push(`
      (
        NULLIF(TRIM(COALESCE(photos.city, '')), '') IS NOT NULL
        OR NULLIF(TRIM(COALESCE(photos.country, '')), '') IS NOT NULL
      )
    `);
  } else if (filters.hasLocation === false) {
    conditions.push(`
      NULLIF(TRIM(COALESCE(photos.city, '')), '') IS NULL
      AND NULLIF(TRIM(COALESCE(photos.country, '')), '') IS NULL
    `);
  }

  for (const missingField of filters.missing) {
    const missingCondition = buildMissingCondition(missingField);

    if (missingCondition) {
      conditions.push(missingCondition);
    }
  }

  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params
  };
}

function addNamedEntityFilter(config) {
  const {
    allValues,
    anyValues,
    conditions,
    params,
    tableName,
    joinedTableName,
    joinedColumnName,
    foreignKeyName
  } = config;

  if (allValues.length > 0) {
    const placeholders = createPlaceholders(allValues.length);
    conditions.push(`
      photos.id IN (
        SELECT ${tableName}.photo_id
        FROM ${tableName}
        INNER JOIN ${joinedTableName} ON ${joinedTableName}.id = ${tableName}.${foreignKeyName}
        WHERE LOWER(${joinedTableName}.${joinedColumnName}) IN (${placeholders})
        GROUP BY ${tableName}.photo_id
        HAVING COUNT(DISTINCT LOWER(${joinedTableName}.${joinedColumnName})) = ?
      )
    `);
    params.push(...allValues, allValues.length);
  }

  if (anyValues.length > 0) {
    const placeholders = createPlaceholders(anyValues.length);
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM ${tableName}
        INNER JOIN ${joinedTableName} ON ${joinedTableName}.id = ${tableName}.${foreignKeyName}
        WHERE ${tableName}.photo_id = photos.id
          AND LOWER(${joinedTableName}.${joinedColumnName}) IN (${placeholders})
      )
    `);
    params.push(...anyValues);
  }
}

function buildPhotoOrderByClause(sort) {
  switch (sort) {
    case "oldest":
      return "ORDER BY COALESCE(photos.captured_at, photos.uploaded_at) ASC, photos.id ASC";
    case "uploaded_newest":
      return "ORDER BY photos.uploaded_at DESC, photos.id DESC";
    case "uploaded_oldest":
      return "ORDER BY photos.uploaded_at ASC, photos.id ASC";
    case "country":
      return "ORDER BY NULLIF(TRIM(COALESCE(photos.country, '')), '') IS NULL, LOWER(COALESCE(photos.country, '')) ASC, COALESCE(photos.captured_at, photos.uploaded_at) DESC, photos.id DESC";
    case "city":
      return "ORDER BY NULLIF(TRIM(COALESCE(photos.city, '')), '') IS NULL, LOWER(COALESCE(photos.city, '')) ASC, COALESCE(photos.captured_at, photos.uploaded_at) DESC, photos.id DESC";
    case "filename":
      return "ORDER BY LOWER(COALESCE(photos.original_filename, '')) ASC, photos.id ASC";
    case "newest":
    default:
      return "ORDER BY COALESCE(photos.captured_at, photos.uploaded_at) DESC, photos.id DESC";
  }
}

function buildMissingCondition(field) {
  if (field === "city") {
    return "NULLIF(TRIM(COALESCE(photos.city, '')), '') IS NULL";
  }

  if (field === "country") {
    return "NULLIF(TRIM(COALESCE(photos.country, '')), '') IS NULL";
  }

  if (field === "people") {
    return `
      NOT EXISTS (SELECT 1 FROM photo_people WHERE photo_people.photo_id = photos.id)
      AND NOT EXISTS (
        SELECT 1
        FROM photo_tags
        INNER JOIN tags ON tags.id = photo_tags.tag_id
        WHERE photo_tags.photo_id = photos.id
          AND LOWER(tags.name) = 'no-people'
      )
    `;
  }

  if (field === "tags") {
    return "NOT EXISTS (SELECT 1 FROM photo_tags WHERE photo_tags.photo_id = photos.id)";
  }

  if (field === "title") {
    return "NULLIF(TRIM(COALESCE(photos.title, '')), '') IS NULL";
  }

  if (field === "alt_text") {
    return "NULLIF(TRIM(COALESCE(photos.alt_text, '')), '') IS NULL";
  }

  if (field === "ai_caption") {
    return "NULLIF(TRIM(COALESCE(photos.ai_caption, '')), '') IS NULL";
  }

  return null;
}

function normalizeStringArray(values) {
  if (values === undefined || values === null) {
    return [];
  }

  const list = Array.isArray(values) ? values : [values];

  return [...new Set(
    list
      .map((value) => String(value).trim().toLowerCase())
      .filter(Boolean)
  )];
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

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue === "" ? null : normalizedValue;
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

function normalizePhotoSort(value) {
  const sort = normalizeOptionalString(value) || "newest";
  const allowed = new Set(["newest", "oldest", "uploaded_newest", "uploaded_oldest", "country", "city", "filename"]);

  if (!allowed.has(sort)) {
    throw new Error(`Unsupported sort: ${sort}`);
  }

  return sort;
}

function normalizePhotoView(value) {
  const view = normalizeOptionalString(value) || "summary";

  if (view !== "summary" && view !== "full" && view !== "blog") {
    throw new Error(`Unsupported view: ${view}`);
  }

  return view;
}

function normalizePhotoOrientation(value) {
  const orientation = normalizeOptionalString(value);

  if (!orientation) {
    return null;
  }

  if (orientation !== "landscape" && orientation !== "portrait" && orientation !== "square") {
    throw new Error(`Unsupported orientation: ${orientation}`);
  }

  return orientation;
}

function createPlaceholders(count) {
  return new Array(count).fill("?").join(", ");
}

function attachPeopleAndTags(db, photos) {
  if (photos.length === 0) {
    return [];
  }

  const photoIds = photos.map((photo) => photo.id);
  const placeholders = createPlaceholders(photoIds.length);
  const peopleRows = db.prepare(`
    SELECT photo_people.photo_id, people.id, people.name
    FROM photo_people
    INNER JOIN people ON people.id = photo_people.person_id
    WHERE photo_people.photo_id IN (${placeholders})
    ORDER BY people.name
  `).all(...photoIds);
  const tagRows = db.prepare(`
    SELECT photo_tags.photo_id, tags.id, tags.name
    FROM photo_tags
    INNER JOIN tags ON tags.id = photo_tags.tag_id
    WHERE photo_tags.photo_id IN (${placeholders})
    ORDER BY tags.name
  `).all(...photoIds);

  const peopleMap = new Map();
  const tagsMap = new Map();

  for (const row of peopleRows) {
    if (!peopleMap.has(row.photo_id)) {
      peopleMap.set(row.photo_id, []);
    }

    peopleMap.get(row.photo_id).push({ id: row.id, name: row.name });
  }

  for (const row of tagRows) {
    if (!tagsMap.has(row.photo_id)) {
      tagsMap.set(row.photo_id, []);
    }

    tagsMap.get(row.photo_id).push(row.name);
  }

  return photos.map((photo) => ({
    ...photo,
    edit_recipe: parseEditRecipeJson(photo.edit_recipe_json),
    people: peopleMap.get(photo.id) || [],
    tags: tagsMap.get(photo.id) || []
  }));
}

function mapPhotoView(photo, view) {
  if (view === "summary") {
    return {
      id: photo.id,
      uuid: photo.uuid,
      original_filename: photo.original_filename,
      title: photo.title,
      captured_at: photo.captured_at,
      city: photo.city,
      country: photo.country,
      thumbnail_url: photo.thumbnail_url,
      small_url: photo.small_url,
      large_url: photo.large_url,
      alt_text: photo.alt_text,
      ai_caption: photo.ai_caption,
      processing_status: photo.processing_status,
      geo_status: photo.geo_status,
      uploaded_at: photo.uploaded_at,
      people: photo.people || [],
      tags: photo.tags || []
    };
  }

  if (view === "blog") {
    return {
      id: photo.id,
      uuid: photo.uuid,
      title: photo.title,
      alt_text: photo.alt_text,
      ai_caption: photo.ai_caption,
      notes_for_ai: photo.notes_for_ai,
      large_url: photo.large_url,
      small_url: photo.small_url,
      width: photo.width,
      height: photo.height,
      captured_at: photo.captured_at,
      city: photo.city,
      country: photo.country,
      location_label: photo.location_label,
      people: photo.people || [],
      tags: photo.tags || []
    };
  }

  return photo;
}

function parseEditRecipeJson(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

module.exports = {
  queryPhotos,
  buildPhotoOrderByClause,
  buildMissingCondition,
  buildPhotoQueryFilters,
  normalizePhotoQueryFilters,
  normalizePhotoQueryOptions,
  normalizePhotoView,
  mapPhotoView
};
