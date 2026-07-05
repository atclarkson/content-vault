const express = require("express");
const { getDb, initializeDatabase } = require("../lib/db");
const { queryPhotos } = require("../lib/photoQuery");
const { queryVideos } = require("../lib/videoQuery");
const { queryJournals } = require("../lib/journalQuery");
const { isQueryBadRequestError } = require("../lib/queryUtils");

const router = express.Router();

initializeDatabase();

router.post("/brief", (req, res) => {
  try {
    const db = getDb();
    const payload = req.body || {};
    const limits = normalizeLimits(payload.limits);
    const sharedFilters = {
      text: payload.text,
      tags_any: payload.tags_any,
      city: payload.city,
      country: payload.country,
      date_from: payload.date_from,
      date_to: payload.date_to,
      people_any: payload.people_any
    };

    const photos = queryPhotos(db, {
      filters: sharedFilters,
      limit: limits.photos,
      offset: 0,
      sort: "newest",
      view: "summary"
    });
    const videos = queryVideos(db, {
      filters: sharedFilters,
      limit: limits.videos,
      offset: 0,
      sort: "newest",
      view: "summary"
    });
    const journals = queryJournals(db, {
      filters: sharedFilters,
      limit: limits.journals,
      offset: 0,
      sort: "newest",
      view: "summary"
    });

    return res.json({
      data: {
        summary: {
          photos: { total: photos.total, returned: photos.items.length },
          videos: { total: videos.total, returned: videos.items.length },
          journals: { total: journals.total, returned: journals.items.length }
        },
        photos: photos.items,
        videos: videos.items,
        journals: journals.items
      }
    });
  } catch (error) {
    if (isQueryBadRequestError(error) || error.message === "Limit values must be integers between 0 and 200") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

function normalizeLimits(limits) {
  const source = limits && typeof limits === "object" && !Array.isArray(limits) ? limits : {};

  return {
    photos: normalizeLimit(source.photos, 20),
    videos: normalizeLimit(source.videos, 10),
    journals: normalizeLimit(source.journals, 5)
  };
}

function normalizeLimit(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > 200) {
    throw new Error("Limit values must be integers between 0 and 200");
  }

  return numericValue;
}

module.exports = router;
