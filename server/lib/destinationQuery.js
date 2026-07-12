function queryDestinations(db, options = {}) {
  const normalizedOptions = normalizeDestinationQueryOptions(options);
  const query = buildDestinationAggregateQuery(normalizedOptions);
  const countQuery = buildDestinationCountQuery(normalizedOptions);

  return {
    items: safeAll(db, query.sql, query.params),
    total: safeGetCount(db, countQuery.sql, countQuery.params),
    applied: normalizedOptions
  };
}

function normalizeDestinationQueryOptions(options) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};

  return {
    country: normalizeOptionalString(source.country),
    min_photos: normalizePositiveInteger(source.min_photos, null, 0, 100000),
    min_videos: normalizePositiveInteger(source.min_videos, null, 0, 100000),
    min_total: normalizePositiveInteger(source.min_total, null, 0, 100000),
    sort: normalizeDestinationSort(source.sort),
    limit: normalizePositiveInteger(source.limit, 0, 0, 100000)
  };
}

function buildDestinationAggregateQuery(options) {
  const parts = buildDestinationQueryParts(options);
  const sql = `
    ${parts.cteSql}
    SELECT
      city,
      country,
      photos,
      videos,
      journals,
      date_first,
      date_last
    FROM combined
    ${buildDestinationOrderByClause(options.sort)}
    ${options.limit > 0 ? "LIMIT ?" : ""}
  `;

  return {
    sql,
    params: options.limit > 0 ? [...parts.params, options.limit] : parts.params
  };
}

function buildDestinationCountQuery(options) {
  const parts = buildDestinationQueryParts(options);

  return {
    sql: `
      ${parts.cteSql}
      SELECT COUNT(*) AS count
      FROM combined
    `,
    params: parts.params
  };
}

function buildDestinationQueryParts(options) {
  const countryFilter = options.country ? "AND LOWER(TRIM(COALESCE(country, ''))) = ?" : "";
  const videoCountryFilter = options.country ? "AND LOWER(TRIM(COALESCE(filmed_country, ''))) = ?" : "";
  const params = [];

  if (options.country) {
    params.push(options.country.toLowerCase(), options.country.toLowerCase(), options.country.toLowerCase(), options.country.toLowerCase());
  }

  const havingClauses = [];

  if (options.min_photos !== null) {
    havingClauses.push("photos >= ?");
    params.push(options.min_photos);
  }

  if (options.min_videos !== null) {
    havingClauses.push("videos >= ?");
    params.push(options.min_videos);
  }

  if (options.min_total !== null) {
    havingClauses.push("(photos + videos + journals) >= ?");
    params.push(options.min_total);
  }

  const havingSql = havingClauses.length > 0 ? `HAVING ${havingClauses.join(" AND ")}` : "";

  return {
    cteSql: `
      WITH destination_seed AS (
        SELECT DISTINCT
          TRIM(city) AS city,
          TRIM(country) AS country
        FROM destinations
        WHERE NULLIF(TRIM(COALESCE(city, '')), '') IS NOT NULL
          AND NULLIF(TRIM(COALESCE(country, '')), '') IS NOT NULL
          ${countryFilter}
      ),
      photo_counts AS (
        SELECT
          TRIM(city) AS city,
          TRIM(country) AS country,
          COUNT(*) AS photos,
          MIN(captured_at) AS date_first,
          MAX(captured_at) AS date_last
        FROM photos
        WHERE deleted_at IS NULL
          AND NULLIF(TRIM(COALESCE(city, '')), '') IS NOT NULL
          AND NULLIF(TRIM(COALESCE(country, '')), '') IS NOT NULL
          ${countryFilter}
        GROUP BY TRIM(city), TRIM(country)
      ),
      video_counts AS (
        SELECT
          TRIM(filmed_city) AS city,
          TRIM(filmed_country) AS country,
          COUNT(*) AS videos,
          MIN(COALESCE(date_filmed, date_published)) AS date_first,
          MAX(COALESCE(date_filmed, date_published)) AS date_last
        FROM videos
        WHERE deleted_at IS NULL
          AND NULLIF(TRIM(COALESCE(filmed_city, '')), '') IS NOT NULL
          AND NULLIF(TRIM(COALESCE(filmed_country, '')), '') IS NOT NULL
          ${videoCountryFilter}
        GROUP BY TRIM(filmed_city), TRIM(filmed_country)
      ),
      journal_counts AS (
        SELECT
          TRIM(city) AS city,
          TRIM(country) AS country,
          COUNT(*) AS journals,
          MIN(entry_date) AS date_first,
          MAX(entry_date) AS date_last
        FROM journal_entries
        WHERE NULLIF(TRIM(COALESCE(city, '')), '') IS NOT NULL
          AND NULLIF(TRIM(COALESCE(country, '')), '') IS NOT NULL
          ${countryFilter}
        GROUP BY TRIM(city), TRIM(country)
      ),
      all_locations AS (
        SELECT city, country FROM destination_seed
        UNION
        SELECT city, country FROM photo_counts
        UNION
        SELECT city, country FROM video_counts
        UNION
        SELECT city, country FROM journal_counts
      ),
      dated_locations AS (
        SELECT city, country, date_first, date_last FROM photo_counts
        UNION ALL
        SELECT city, country, date_first, date_last FROM video_counts
        UNION ALL
        SELECT city, country, date_first, date_last FROM journal_counts
      ),
      base_counts AS (
        SELECT
          all_locations.city AS city,
          all_locations.country AS country,
          COALESCE(photo_counts.photos, 0) AS photos,
          COALESCE(video_counts.videos, 0) AS videos,
          COALESCE(journal_counts.journals, 0) AS journals
        FROM all_locations
        LEFT JOIN photo_counts
          ON photo_counts.city = all_locations.city
         AND photo_counts.country = all_locations.country
        LEFT JOIN video_counts
          ON video_counts.city = all_locations.city
         AND video_counts.country = all_locations.country
        LEFT JOIN journal_counts
          ON journal_counts.city = all_locations.city
         AND journal_counts.country = all_locations.country
      ),
      combined AS (
        SELECT
          base_counts.city,
          base_counts.country,
          base_counts.photos,
          base_counts.videos,
          base_counts.journals,
          MIN(dated_locations.date_first) AS date_first,
          MAX(dated_locations.date_last) AS date_last
        FROM base_counts
        LEFT JOIN dated_locations
          ON dated_locations.city = base_counts.city
         AND dated_locations.country = base_counts.country
        GROUP BY
          base_counts.city,
          base_counts.country,
          base_counts.photos,
          base_counts.videos,
          base_counts.journals
        ${havingSql}
      )
    `,
    params
  };
}

function buildDestinationOrderByClause(sort) {
  if (sort === "photos") {
    return "ORDER BY photos DESC, country ASC, city ASC";
  }

  if (sort === "videos") {
    return "ORDER BY videos DESC, country ASC, city ASC";
  }

  if (sort === "date_last") {
    return "ORDER BY date_last DESC, country ASC, city ASC";
  }

  if (sort === "city") {
    return "ORDER BY city ASC, country ASC";
  }

  return "ORDER BY (photos + videos + journals) DESC, country ASC, city ASC";
}

function normalizeDestinationSort(value) {
  const sort = normalizeOptionalString(value);

  if (!sort) {
    return null;
  }

  if (sort !== "photos" && sort !== "videos" && sort !== "date_last" && sort !== "city") {
    throw new Error(`Unsupported sort: ${sort}`);
  }

  return sort;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue === "" ? null : normalizedValue;
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

function safeAll(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (error) {
    if (error.message && error.message.includes("no such table:")) {
      return [];
    }

    throw error;
  }
}

function safeGetCount(db, sql, params = []) {
  try {
    return Number(db.prepare(sql).get(...params)?.count || 0);
  } catch (error) {
    if (error.message && error.message.includes("no such table:")) {
      return 0;
    }

    throw error;
  }
}

module.exports = {
  queryDestinations,
  normalizeDestinationQueryOptions,
  buildDestinationAggregateQuery
};
