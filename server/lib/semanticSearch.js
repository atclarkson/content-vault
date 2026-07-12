const { queryPhotos } = require("./photoQuery");
const { queryVideos } = require("./videoQuery");
const { queryJournals } = require("./journalQuery");
const { uploadFile, deleteFile } = require("./r2");

const DEFAULT_R2_PREFIX = "ai-search";
const CONTENT_TYPES = new Set(["photo", "video", "journal"]);

function getRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getSemanticSearchConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;

  if (!accountId) {
    throw new Error("Missing required environment variable: CLOUDFLARE_ACCOUNT_ID or R2_ACCOUNT_ID");
  }

  return {
    accountId,
    instanceId: getRequiredEnv("AI_SEARCH_INSTANCE_ID"),
    apiToken: getRequiredEnv("AI_SEARCH_API_TOKEN"),
    r2Prefix: normalizeR2Prefix(process.env.AI_SEARCH_R2_PREFIX || DEFAULT_R2_PREFIX)
  };
}

function normalizeR2Prefix(value) {
  return String(value || DEFAULT_R2_PREFIX)
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function normalizeContentTypes(values, defaultValue = ["photo", "video", "journal"]) {
  if (values === undefined || values === null || values === "") {
    return defaultValue;
  }

  const list = Array.isArray(values) ? values : [values];
  const normalized = [...new Set(list.map((value) => String(value).trim().toLowerCase()).filter(Boolean))];

  if (normalized.some((value) => !CONTENT_TYPES.has(value))) {
    throw new Error("content_types must only include photo, video, or journal");
  }

  return normalized;
}

function normalizeSemanticSearchOptions(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const query = String(source.query || "").trim();

  if (!query) {
    throw new Error("query is required");
  }

  const limit = normalizeLimit(source.limit, 12);

  return {
    query,
    limit,
    contentTypes: normalizeContentTypes(source.content_types),
    city: normalizeOptionalString(source.city),
    country: normalizeOptionalString(source.country),
    dateFrom: normalizeOptionalString(source.date_from),
    dateTo: normalizeOptionalString(source.date_to)
  };
}

async function searchSemanticContent(db, input = {}) {
  const options = normalizeSemanticSearchOptions(input);
  const response = await runSemanticSearchRequest(options);
  const hits = parseSemanticSearchResponse(response);
  const filteredHits = hits
    .filter((hit) => options.contentTypes.includes(hit.contentType))
    .slice(0, options.limit);

  return hydrateSemanticHits(db, {
    query: options.query,
    limit: options.limit,
    contentTypes: options.contentTypes,
    hits: filteredHits
  });
}

async function runSemanticSearchRequest(options) {
  const config = getSemanticSearchConfig();
  const filters = buildAiSearchFilters(options);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai-search/instances/${config.instanceId}/search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: options.query }],
        ai_search_options: {
          retrieval: {
            ...(filters ? { filters } : {}),
            max_num_results: options.limit
          }
        }
      })
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.errors?.[0]?.message || data?.error || "Cloudflare AI Search request failed";
    throw new Error(message);
  }

  return data;
}

function buildAiSearchFilters(options) {
  const filters = {};

  if (options.contentTypes.length === 1) {
    filters.content_type = options.contentTypes[0];
  } else if (options.contentTypes.length > 1 && options.contentTypes.length < CONTENT_TYPES.size) {
    filters.content_type = { $in: options.contentTypes };
  }

  if (options.city) {
    filters.city = options.city;
  }

  if (options.country) {
    filters.country = options.country;
  }

  const dateRange = {};
  const dateFromTimestamp = toUnixTimestamp(options.dateFrom);
  const dateToTimestamp = toUnixTimestamp(options.dateTo);

  if (dateFromTimestamp !== null) {
    dateRange.$gte = dateFromTimestamp;
  }

  if (dateToTimestamp !== null) {
    dateRange.$lte = dateToTimestamp;
  }

  if (Object.keys(dateRange).length > 0) {
    filters.date_ts = dateRange;
  }

  return Object.keys(filters).length > 0 ? filters : null;
}

function parseSemanticSearchResponse(payload) {
  const arrays = collectArrays(payload, []);

  for (const value of arrays) {
    const hits = value
      .map((item) => normalizeSemanticHit(item))
      .filter(Boolean);

    if (hits.length > 0) {
      return hits;
    }
  }

  return [];
}

function collectArrays(value, arrays) {
  if (Array.isArray(value)) {
    arrays.push(value);

    for (const item of value) {
      collectArrays(item, arrays);
    }

    return arrays;
  }

  if (!value || typeof value !== "object") {
    return arrays;
  }

  for (const nestedValue of Object.values(value)) {
    collectArrays(nestedValue, arrays);
  }

  return arrays;
}

function normalizeSemanticHit(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const key =
    item?.item?.key ||
    item?.key ||
    item?.filename ||
    item?.item?.filename ||
    item?.metadata?.filename ||
    null;

  const parsedKey = key ? parseDocumentKey(key) : null;

  if (!parsedKey) {
    return null;
  }

  return {
    contentType: parsedKey.contentType,
    recordId: parsedKey.recordId,
    key,
    score: normalizeScore(item.score),
    excerpt: normalizeOptionalString(item.text || item.content || item.snippet || "")
  };
}

function normalizeScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

async function hydrateSemanticHits(db, options) {
  const groupedIds = {
    photo: [],
    video: [],
    journal: []
  };

  for (const hit of options.hits) {
    groupedIds[hit.contentType].push(hit.recordId);
  }

  const [photos, videos, journals] = await Promise.all([
    groupedIds.photo.length > 0
      ? Promise.resolve(queryPhotos(db, {
        filters: { ids: groupedIds.photo, include_deleted: false },
        limit: groupedIds.photo.length,
        offset: 0,
        sort: "newest",
        view: "summary"
      }).items)
      : Promise.resolve([]),
    groupedIds.video.length > 0
      ? Promise.resolve(queryVideos(db, {
        filters: { ids: groupedIds.video },
        limit: groupedIds.video.length,
        offset: 0,
        sort: "newest",
        view: "summary"
      }).items)
      : Promise.resolve([]),
    groupedIds.journal.length > 0
      ? Promise.resolve(queryJournals(db, {
        filters: { ids: groupedIds.journal },
        limit: groupedIds.journal.length,
        offset: 0,
        sort: "newest",
        view: "summary"
      }).items)
      : Promise.resolve([])
  ]);

  const itemMap = new Map();

  for (const photo of photos) {
    itemMap.set(`photo:${photo.id}`, photo);
  }

  for (const video of videos) {
    itemMap.set(`video:${video.id}`, video);
  }

  for (const journal of journals) {
    itemMap.set(`journal:${journal.id}`, journal);
  }

  const items = options.hits
    .map((hit) => {
      const record = itemMap.get(`${hit.contentType}:${hit.recordId}`);

      if (!record) {
        return null;
      }

      return {
        type: hit.contentType,
        score: hit.score,
        excerpt: hit.excerpt,
        record
      };
    })
    .filter(Boolean);

  return {
    query: options.query,
    limit: options.limit,
    total_hits: options.hits.length,
    items,
    photos,
    videos,
    journals
  };
}

async function syncSemanticSearchDocuments(db, options = {}) {
  const config = getSemanticSearchConfig();
  const contentTypes = normalizeContentTypes(options.contentTypes);
  const summaries = [];

  if (contentTypes.includes("photo")) {
    summaries.push(await syncPhotoDocuments(db, config));
  }

  if (contentTypes.includes("video")) {
    summaries.push(await syncVideoDocuments(db, config));
  }

  if (contentTypes.includes("journal")) {
    summaries.push(await syncJournalDocuments(db, config));
  }

  return summaries;
}

async function syncPhotoDocuments(db, config) {
  const activePhotos = collectAllQueryItems((limit, offset) => queryPhotos(db, {
    filters: { include_deleted: false },
    limit,
    offset,
    sort: "newest",
    view: "full"
  }));
  const deletedPhotos = db.prepare(`
    SELECT id
    FROM photos
    WHERE deleted_at IS NOT NULL
  `).all();

  for (const photo of activePhotos) {
    await uploadSemanticDocument(config, "photo", photo.id, buildPhotoDocument(photo), buildCommonMetadata("photo", photo));
  }

  for (const row of deletedPhotos) {
    await deleteSemanticDocument(config, "photo", row.id);
  }

  return {
    content_type: "photo",
    uploaded: activePhotos.length,
    deleted: deletedPhotos.length
  };
}

async function syncVideoDocuments(db, config) {
  const activeVideos = collectAllQueryItems((limit, offset) => queryVideos(db, {
    filters: {},
    limit,
    offset,
    sort: "newest",
    view: "full"
  }));
  const deletedVideos = db.prepare(`
    SELECT id
    FROM videos
    WHERE deleted_at IS NOT NULL
  `).all();

  for (const video of activeVideos) {
    await uploadSemanticDocument(config, "video", video.id, buildVideoDocument(video), buildCommonMetadata("video", video));
  }

  for (const row of deletedVideos) {
    await deleteSemanticDocument(config, "video", row.id);
  }

  return {
    content_type: "video",
    uploaded: activeVideos.length,
    deleted: deletedVideos.length
  };
}

async function syncJournalDocuments(db, config) {
  const journals = collectAllQueryItems((limit, offset) => queryJournals(db, {
    filters: {},
    limit,
    offset,
    sort: "newest",
    view: "full"
  }));

  for (const journal of journals) {
    await uploadSemanticDocument(config, "journal", journal.id, buildJournalDocument(journal), buildCommonMetadata("journal", journal));
  }

  return {
    content_type: "journal",
    uploaded: journals.length,
    deleted: 0
  };
}

async function uploadSemanticDocument(config, contentType, recordId, body, metadata) {
  const key = buildDocumentKey(config.r2Prefix, contentType, recordId);
  await uploadFile(key, Buffer.from(body, "utf8"), "text/markdown; charset=utf-8", { metadata });
}

async function deleteSemanticDocument(config, contentType, recordId) {
  const key = buildDocumentKey(config.r2Prefix, contentType, recordId);

  try {
    await deleteFile(key);
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey") {
      return;
    }

    throw error;
  }
}

function buildDocumentKey(prefix, contentType, recordId) {
  return `${prefix}/${contentType}s/${recordId}.md`;
}

function parseDocumentKey(key) {
  const match = String(key || "").match(/(?:^|\/)(photos|videos|journals)\/(\d+)\.md$/i);

  if (!match) {
    return null;
  }

  return {
    contentType: match[1] === "photos" ? "photo" : match[1] === "videos" ? "video" : "journal",
    recordId: Number(match[2])
  };
}

function buildCommonMetadata(contentType, record) {
  return {
    content_type: contentType,
    record_id: record.id,
    city: record.city || null,
    country: record.country || null,
    date_ts: toUnixTimestamp(
      record.captured_at
      || record.uploaded_at
      || record.date_filmed
      || record.date_published
      || record.published_at
      || record.date
      || record.entry_date
    )
  };
}

function buildPhotoDocument(photo) {
  return [
    `# Photo ${photo.id}`,
    "",
    `Title: ${photo.title || "Untitled photo"}`,
    `Date: ${photo.captured_at || photo.uploaded_at || "Unknown"}`,
    `Location: ${formatLocation(photo.city, photo.country)}`,
    `People: ${formatPeople(photo.people)}`,
    `Tags: ${formatTags(photo.tags)}`,
    `Filename: ${photo.original_filename || "Unknown"}`,
    "",
    "## Descriptions",
    "",
    `Caption: ${photo.ai_caption || "None"}`,
    `Alt text: ${photo.alt_text || "None"}`,
    `Description: ${photo.description || "None"}`,
    `Notes: ${photo.notes_for_ai || "None"}`,
    "",
    "## URLs",
    "",
    `Thumbnail: ${photo.thumbnail_url || "None"}`,
    `Preview: ${photo.small_url || photo.large_url || "None"}`
  ].join("\n");
}

function buildVideoDocument(video) {
  return [
    `# Video ${video.id}`,
    "",
    `Title: ${video.title || "Untitled video"}`,
    `Date: ${video.date_filmed || video.date_published || "Unknown"}`,
    `Location: ${formatLocation(video.city, video.country)}`,
    `People: ${formatPeople(video.people)}`,
    `Tags: ${formatTags(video.tags)}`,
    `YouTube ID: ${video.youtube_id || "None"}`,
    `Duration seconds: ${video.duration_seconds || 0}`,
    "",
    "## Descriptions",
    "",
    `Description: ${video.description || "None"}`,
    `Caption: ${video.ai_caption || "None"}`,
    `Alt text: ${video.alt_text || "None"}`,
    `Notes: ${video.notes_for_ai || "None"}`,
    "",
    "## Transcript",
    "",
    video.subtitles_text || "None"
  ].join("\n");
}

function buildJournalDocument(journal) {
  return [
    `# Journal Entry ${journal.id}`,
    "",
    `Title: ${journal.title || "Untitled journal entry"}`,
    `Date: ${journal.date || journal.entry_date || "Unknown"}`,
    `Location: ${formatLocation(journal.city, journal.country)}`,
    "",
    "## Body",
    "",
    journal.body || journal.excerpt || "None"
  ].join("\n");
}

function formatPeople(people) {
  if (!Array.isArray(people) || people.length === 0) {
    return "None";
  }

  return people.map((person) => person.name).filter(Boolean).join(", ") || "None";
}

function formatTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return "None";
  }

  return tags.join(", ");
}

function formatLocation(city, country) {
  const parts = [city, country].map((value) => normalizeOptionalString(value)).filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "Unknown";
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
}

function normalizeLimit(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 1 || numericValue > 50) {
    throw new Error("limit must be an integer between 1 and 50");
  }

  return numericValue;
}

function collectAllQueryItems(runQuery) {
  const limit = 200;
  const items = [];
  let offset = 0;

  while (true) {
    const result = runQuery(limit, offset);
    items.push(...result.items);

    if (result.items.length < limit) {
      return items;
    }

    offset += limit;
  }
}

function toUnixTimestamp(value) {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return null;
  }

  const parsed = Date.parse(normalized);

  if (Number.isNaN(parsed)) {
    return null;
  }

  return Math.floor(parsed / 1000);
}

module.exports = {
  buildDocumentKey,
  getSemanticSearchConfig,
  normalizeContentTypes,
  normalizeSemanticSearchOptions,
  parseDocumentKey,
  parseSemanticSearchResponse,
  searchSemanticContent,
  syncSemanticSearchDocuments
};
