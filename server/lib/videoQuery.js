const {
  createPlaceholders,
  normalizeOptionalBoolean,
  normalizeOptionalString,
  normalizePositiveInteger,
  normalizeSort,
  normalizeStringArray,
  normalizeView,
  tableExists
} = require("./queryUtils");

const YOUTUBE_THUMBNAIL_BASE = "https://img.youtube.com/vi";

function queryVideos(db, options = {}) {
  const normalizedOptions = normalizeVideoQueryOptions(options);

  if (!tableExists(db, "videos")) {
    return {
      items: [],
      total: 0,
      limit: normalizedOptions.limit,
      offset: normalizedOptions.offset
    };
  }

  const filters = buildVideoQueryFilters(normalizedOptions.filters);
  const orderByClause = buildVideoOrderByClause(normalizedOptions.sort);
  const rows = db.prepare(`
    SELECT videos.*
    FROM videos
    ${filters.whereClause}
    ${orderByClause}
    LIMIT ?
    OFFSET ?
  `).all(...filters.params, normalizedOptions.limit, normalizedOptions.offset);
  const totalRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM videos
    ${filters.whereClause}
  `).get(...filters.params);

  return {
    items: attachPeopleAndTags(db, rows).map((video) => mapVideoView(video, normalizedOptions.view)),
    total: totalRow.count,
    limit: normalizedOptions.limit,
    offset: normalizedOptions.offset
  };
}

function normalizeVideoQueryOptions(options) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const filtersSource = source.filters && typeof source.filters === "object" && !Array.isArray(source.filters)
    ? source.filters
    : source;

  return {
    filters: {
      text: normalizeOptionalString(filtersSource.text),
      tagsAny: normalizeStringArray(filtersSource.tags_any),
      tagsAll: normalizeStringArray(filtersSource.tags_all),
      city: normalizeOptionalString(filtersSource.city),
      country: normalizeOptionalString(filtersSource.country),
      dateFrom: normalizeOptionalString(filtersSource.date_from),
      dateTo: normalizeOptionalString(filtersSource.date_to),
      peopleAny: normalizeStringArray(filtersSource.people_any),
      peopleAll: normalizeStringArray(filtersSource.people_all),
      hasTags: normalizeOptionalBoolean(filtersSource.has_tags),
      hasLocation: normalizeOptionalBoolean(filtersSource.has_location)
    },
    limit: normalizePositiveInteger(source.limit, 20, 0, 200),
    offset: normalizePositiveInteger(source.offset, 0, 0, 100000),
    sort: normalizeSort(source.sort, ["newest", "oldest"], "newest"),
    view: normalizeView(source.view, ["summary", "full"], "summary")
  };
}

function buildVideoQueryFilters(filters) {
  const conditions = ["videos.deleted_at IS NULL"];
  const params = [];

  if (filters.text) {
    const searchPattern = `%${filters.text.toLowerCase()}%`;
    conditions.push(`
      (
        LOWER(COALESCE(videos.title, '')) LIKE ?
        OR LOWER(COALESCE(videos.description, '')) LIKE ?
        OR EXISTS (
          SELECT 1
          FROM video_tags
          INNER JOIN tags ON tags.id = video_tags.tag_id
          WHERE video_tags.video_id = videos.id
            AND LOWER(tags.name) LIKE ?
        )
      )
    `);
    params.push(searchPattern, searchPattern, searchPattern);
  }

  addNamedEntityFilter({
    allValues: filters.tagsAll,
    anyValues: filters.tagsAny,
    conditions,
    params,
    joinTable: "video_tags",
    foreignKey: "tag_id",
    targetTable: "tags",
    targetColumn: "name"
  });

  addNamedEntityFilter({
    allValues: filters.peopleAll,
    anyValues: filters.peopleAny,
    conditions,
    params,
    joinTable: "video_people",
    foreignKey: "person_id",
    targetTable: "people",
    targetColumn: "name"
  });

  if (filters.city) {
    conditions.push("LOWER(COALESCE(videos.filmed_city, '')) LIKE ?");
    params.push(`%${filters.city.toLowerCase()}%`);
  }

  if (filters.country) {
    conditions.push("LOWER(COALESCE(videos.filmed_country, '')) LIKE ?");
    params.push(`%${filters.country.toLowerCase()}%`);
  }

  if (filters.dateFrom) {
    conditions.push("COALESCE(videos.date_filmed, videos.date_published) >= ?");
    params.push(filters.dateFrom);
  }

  if (filters.dateTo) {
    conditions.push("COALESCE(videos.date_filmed, videos.date_published) <= ?");
    params.push(filters.dateTo);
  }

  if (filters.hasTags === true) {
    conditions.push("EXISTS (SELECT 1 FROM video_tags WHERE video_tags.video_id = videos.id)");
  } else if (filters.hasTags === false) {
    conditions.push("NOT EXISTS (SELECT 1 FROM video_tags WHERE video_tags.video_id = videos.id)");
  }

  if (filters.hasLocation === true) {
    conditions.push(`
      (
        NULLIF(TRIM(COALESCE(videos.filmed_city, '')), '') IS NOT NULL
        OR NULLIF(TRIM(COALESCE(videos.filmed_country, '')), '') IS NOT NULL
      )
    `);
  } else if (filters.hasLocation === false) {
    conditions.push(`
      NULLIF(TRIM(COALESCE(videos.filmed_city, '')), '') IS NULL
      AND NULLIF(TRIM(COALESCE(videos.filmed_country, '')), '') IS NULL
    `);
  }

  return {
    whereClause: `WHERE ${conditions.join(" AND ")}`,
    params
  };
}

function addNamedEntityFilter(config) {
  const {
    allValues,
    anyValues,
    conditions,
    params,
    joinTable,
    foreignKey,
    targetTable,
    targetColumn
  } = config;

  if (allValues.length > 0) {
    const placeholders = createPlaceholders(allValues.length);
    conditions.push(`
      videos.id IN (
        SELECT ${joinTable}.video_id
        FROM ${joinTable}
        INNER JOIN ${targetTable} ON ${targetTable}.id = ${joinTable}.${foreignKey}
        WHERE LOWER(${targetTable}.${targetColumn}) IN (${placeholders})
        GROUP BY ${joinTable}.video_id
        HAVING COUNT(DISTINCT LOWER(${targetTable}.${targetColumn})) = ?
      )
    `);
    params.push(...allValues, allValues.length);
  }

  if (anyValues.length > 0) {
    const placeholders = createPlaceholders(anyValues.length);
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM ${joinTable}
        INNER JOIN ${targetTable} ON ${targetTable}.id = ${joinTable}.${foreignKey}
        WHERE ${joinTable}.video_id = videos.id
          AND LOWER(${targetTable}.${targetColumn}) IN (${placeholders})
      )
    `);
    params.push(...anyValues);
  }
}

function buildVideoOrderByClause(sort) {
  if (sort === "oldest") {
    return "ORDER BY COALESCE(videos.date_filmed, videos.date_published, videos.created_at) ASC, videos.id ASC";
  }

  return "ORDER BY COALESCE(videos.date_filmed, videos.date_published, videos.created_at) DESC, videos.id DESC";
}

function attachPeopleAndTags(db, videos) {
  if (videos.length === 0) {
    return [];
  }

  const videoIds = videos.map((video) => video.id);
  const placeholders = createPlaceholders(videoIds.length);
  const peopleRows = db.prepare(`
    SELECT video_people.video_id, people.id, people.name
    FROM video_people
    INNER JOIN people ON people.id = video_people.person_id
    WHERE video_people.video_id IN (${placeholders})
    ORDER BY people.name
  `).all(...videoIds);
  const tagRows = db.prepare(`
    SELECT video_tags.video_id, tags.id, tags.name
    FROM video_tags
    INNER JOIN tags ON tags.id = video_tags.tag_id
    WHERE video_tags.video_id IN (${placeholders})
    ORDER BY tags.name
  `).all(...videoIds);

  const peopleMap = new Map();
  const tagsMap = new Map();

  for (const row of peopleRows) {
    if (!peopleMap.has(row.video_id)) {
      peopleMap.set(row.video_id, []);
    }

    peopleMap.get(row.video_id).push({ id: row.id, name: row.name });
  }

  for (const row of tagRows) {
    if (!tagsMap.has(row.video_id)) {
      tagsMap.set(row.video_id, []);
    }

    tagsMap.get(row.video_id).push(row.name);
  }

  return videos.map((video) => ({
    ...video,
    people: peopleMap.get(video.id) || [],
    tags: tagsMap.get(video.id) || []
  }));
}

function mapVideoView(video, view) {
  const thumbnailUrl = video.thumbnail_url || (video.youtube_id ? `${YOUTUBE_THUMBNAIL_BASE}/${video.youtube_id}/hqdefault.jpg` : null);
  const summary = {
    id: video.id,
    uuid: video.youtube_id,
    title: video.title,
    youtube_id: video.youtube_id,
    thumbnail_url: thumbnailUrl,
    published_at: video.date_published,
    duration_seconds: video.duration_seconds,
    city: video.filmed_city,
    country: video.filmed_country,
    description: video.description,
    tags: video.tags || [],
    people: video.people || []
  };

  if (view === "summary") {
    return summary;
  }

  return {
    ...summary,
    youtube_url: video.youtube_url,
    date_published: video.date_published,
    date_filmed: video.date_filmed,
    date_filmed_end: video.date_filmed_end,
    video_type: video.video_type,
    video_category: video.video_category,
    ai_caption: video.ai_caption,
    alt_text: video.alt_text,
    subtitles_text: video.subtitles_text,
    notes_for_ai: video.notes_for_ai,
    view_count: video.view_count,
    like_count: video.like_count,
    comment_count: video.comment_count,
    created_at: video.created_at,
    updated_at: video.updated_at
  };
}

module.exports = {
  queryVideos
};
