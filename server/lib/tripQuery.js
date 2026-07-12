const { queryPhotos } = require("./photoQuery");
const { queryVideos } = require("./videoQuery");
const { queryJournals } = require("./journalQuery");

function getTrip(db, options = {}, dependencies = {}) {
  const queryPhotosImpl = dependencies.queryPhotos || queryPhotos;
  const queryVideosImpl = dependencies.queryVideos || queryVideos;
  const queryJournalsImpl = dependencies.queryJournals || queryJournals;
  const normalizedOptions = normalizeTripOptions(options);
  const sharedFilters = {
    date_from: normalizedOptions.dateFrom,
    date_to: normalizedOptions.dateTo,
    city: normalizedOptions.city,
    country: normalizedOptions.country
  };

  const photos = queryPhotosImpl(db, {
    filters: sharedFilters,
    limit: normalizedOptions.limitPerType,
    offset: 0,
    sort: "oldest",
    view: "blog"
  });
  const videos = queryVideosImpl(db, {
    filters: sharedFilters,
    limit: normalizedOptions.limitPerType,
    offset: 0,
    sort: "oldest",
    view: "full"
  });
  const journals = queryJournalsImpl(db, {
    filters: sharedFilters,
    limit: normalizedOptions.limitPerType,
    offset: 0,
    sort: "oldest",
    view: "full"
  });

  return {
    date_from: normalizedOptions.dateFrom,
    date_to: normalizedOptions.dateTo,
    counts: buildCounts(normalizedOptions.limitPerType, { photos, videos, journals }),
    timeline: buildTimeline({ photos, videos, journals })
  };
}

function normalizeTripOptions(options) {
  const source = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const dateFrom = normalizeRequiredIsoDate(source.date_from, "date_from");
  const dateTo = normalizeRequiredIsoDate(source.date_to, "date_to");

  return {
    dateFrom,
    dateTo,
    city: normalizeOptionalString(source.city),
    country: normalizeOptionalString(source.country),
    limitPerType: normalizePositiveInteger(source.limit_per_type, 25, 1, 100)
  };
}

function buildCounts(limitPerType, results) {
  const counts = {
    photos: results.photos.total,
    videos: results.videos.total,
    journals: results.journals.total
  };

  if (results.photos.total > limitPerType) {
    counts.photos_truncated = true;
  }

  if (results.videos.total > limitPerType) {
    counts.videos_truncated = true;
  }

  if (results.journals.total > limitPerType) {
    counts.journals_truncated = true;
  }

  return counts;
}

function buildTimeline(results) {
  const timeline = [
    ...results.journals.items.map(mapJournalTimelineItem),
    ...results.photos.items.map(mapPhotoTimelineItem),
    ...results.videos.items.map(mapVideoTimelineItem)
  ];

  timeline.sort((left, right) => {
    const leftTime = Date.parse(left.date || "") || 0;
    const rightTime = Date.parse(right.date || "") || 0;

    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return getTimelineTypeRank(left.type) - getTimelineTypeRank(right.type);
  });

  return timeline;
}

function mapJournalTimelineItem(entry) {
  return {
    type: "journal",
    date: entry.date,
    title: entry.title,
    body: entry.body || "",
    city: entry.city,
    country: entry.country
  };
}

function mapPhotoTimelineItem(photo) {
  return {
    type: "photo",
    date: photo.captured_at,
    uuid: photo.uuid,
    title: photo.title,
    ai_caption: photo.ai_caption,
    notes_for_ai: photo.notes_for_ai,
    large_url: photo.large_url,
    width: photo.width,
    height: photo.height,
    city: photo.city,
    country: photo.country,
    people: photo.people || [],
    tags: photo.tags || []
  };
}

function mapVideoTimelineItem(video) {
  return {
    type: "video",
    date: video.date_filmed || video.published_at,
    youtube_id: video.youtube_id,
    title: video.title,
    description_excerpt: createDescriptionExcerpt(video.description),
    duration_seconds: video.duration_seconds,
    city: video.city,
    country: video.country
  };
}

function createDescriptionExcerpt(description) {
  if (description === null || description === undefined) {
    return null;
  }

  const text = String(description).trim();

  if (!text) {
    return "";
  }

  if (text.length <= 300) {
    return text;
  }

  const truncated = text.slice(0, 300);
  const lastWhitespaceIndex = truncated.search(/\s\S*$/);
  const safeText = lastWhitespaceIndex > 0 ? truncated.slice(0, lastWhitespaceIndex) : truncated;

  return `${safeText.trimEnd()}...`;
}

function getTimelineTypeRank(type) {
  if (type === "journal") {
    return 0;
  }

  if (type === "photo") {
    return 1;
  }

  return 2;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue === "" ? null : normalizedValue;
}

function normalizeRequiredIsoDate(value, fieldName) {
  const normalizedValue = normalizeOptionalString(value);

  if (!normalizedValue) {
    throw new Error(`${fieldName} is required`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue) || Number.isNaN(Date.parse(normalizedValue))) {
    throw new Error(`${fieldName} must be an ISO date`);
  }

  return normalizedValue;
}

function normalizePositiveInteger(value, defaultValue, min, max) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < min || numericValue > max) {
    throw new Error(`limit_per_type must be an integer between ${min} and ${max}`);
  }

  return numericValue;
}

module.exports = {
  getTrip,
  createDescriptionExcerpt,
  normalizeTripOptions
};
