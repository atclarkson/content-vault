const express = require("express");
const { getDb, initializeDatabase } = require("../lib/db");
const {
  getUploadsPlaylistId,
  getPlaylistVideoIds,
  getVideoDetails,
  getVideoStats,
} = require("../lib/youtube");

const router = express.Router();

initializeDatabase();

router.post("/sync", async (req, res) => {
  try {
    const db = getDb();
    const playlistId = await getUploadsPlaylistId();
    const youtubeIds = await getPlaylistVideoIds(playlistId);
    const uniqueIds = [...new Set(youtubeIds)];

    if (uniqueIds.length === 0) {
      return res.json({ data: { added: 0, skipped: 0 } });
    }

    const existingIds = findExistingYoutubeIds(db, uniqueIds);
    const newIds = uniqueIds.filter((youtubeId) => !existingIds.has(youtubeId));

    if (newIds.length === 0) {
      return res.json({ data: { added: 0, skipped: uniqueIds.length } });
    }

    const videoDetails = await getVideoDetails(newIds);
    const insertVideo = db.prepare(`
      INSERT INTO videos (
        youtube_id,
        youtube_url,
        title,
        description,
        thumbnail_url,
        duration_seconds,
        video_type,
        date_published,
        view_count,
        like_count,
        comment_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((videos) => {
      for (const video of videos) {
        insertVideo.run(
          video.youtube_id,
          video.youtube_url,
          video.title || null,
          video.description || null,
          video.thumbnail_url || null,
          video.duration_seconds,
          video.duration_seconds < 181 ? "short" : "longform",
          video.date_published,
          video.view_count,
          video.like_count,
          video.comment_count,
        );
      }
    });

    insertMany(videoDetails);

    return res.json({
      data: {
        added: videoDetails.length,
        skipped: uniqueIds.length - videoDetails.length,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/refresh-stats", async (req, res) => {
  try {
    const db = getDb();
    const videos = db
      .prepare(
        `
      SELECT id, youtube_id
      FROM videos
      WHERE deleted_at IS NULL
      ORDER BY id
    `,
      )
      .all();

    if (videos.length === 0) {
      return res.json({ data: { updated: 0 } });
    }

    const stats = await getVideoStats(videos.map((video) => video.youtube_id));
    const updateStats = db.prepare(`
      UPDATE videos
      SET view_count = ?,
          like_count = ?,
          comment_count = ?,
          stats_refreshed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE youtube_id = ?
    `);

    const applyStats = db.transaction((rows) => {
      for (const row of rows) {
        updateStats.run(
          row.view_count,
          row.like_count,
          row.comment_count,
          row.youtube_id,
        );
      }
    });

    applyStats(stats);

    return res.json({ data: { updated: stats.length } });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const videos = db
      .prepare(
        `
      SELECT videos.*
      FROM videos
      WHERE videos.deleted_at IS NULL
      ORDER BY videos.date_published DESC, videos.id DESC
    `,
      )
      .all();

    return res.json({ data: attachPeopleAndTags(db, videos) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/:id", (req, res) => {
  try {
    const db = getDb();
    const videoId = normalizeVideoId(req.params.id);
    const video = db
      .prepare(
        `
      SELECT *
      FROM videos
      WHERE id = ?
        AND deleted_at IS NULL
    `,
      )
      .get(videoId);

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    return res.json({ data: attachPeopleAndTags(db, [video])[0] });
  } catch (error) {
    if (error.message === "Invalid video id") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    const db = getDb();
    const videoId = normalizeVideoId(req.params.id);
    const payload = req.body || {};
    const existingVideo = db
      .prepare("SELECT * FROM videos WHERE id = ?")
      .get(videoId);

    if (!existingVideo || existingVideo.deleted_at) {
      return res.status(404).json({ error: "Video not found" });
    }

    const people = Object.prototype.hasOwnProperty.call(payload, "people")
      ? normalizeIdArray(payload.people)
      : null;
    const tags = Object.prototype.hasOwnProperty.call(payload, "tags")
      ? normalizeTagNames(payload.tags)
      : null;

    validateVideoPayload(payload);

    const updates = [];
    const params = [];

    addScalarUpdate(updates, params, payload, "title");
    addScalarUpdate(updates, params, payload, "description");
    addScalarUpdate(updates, params, payload, "alt_text");
    addScalarUpdate(updates, params, payload, "ai_caption");
    addScalarUpdate(updates, params, payload, "notes_for_ai");
    addScalarUpdate(updates, params, payload, "video_type");
    addScalarUpdate(updates, params, payload, "video_type_manually_set");
    addScalarUpdate(updates, params, payload, "video_category");
    addScalarUpdate(updates, params, payload, "date_filmed");
    addScalarUpdate(updates, params, payload, "date_filmed_end");
    addScalarUpdate(updates, params, payload, "date_filmed_source");
    addScalarUpdate(updates, params, payload, "filmed_city");
    addScalarUpdate(updates, params, payload, "filmed_country");
    addScalarUpdate(updates, params, payload, "filmed_location_source");

    const applyUpdate = db.transaction(() => {
      if (updates.length > 0) {
        params.push(videoId);
        db.prepare(
          `
          UPDATE videos
          SET ${updates.join(", ")},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        ).run(...params);
      }

      if (people !== null) {
        ensurePeopleExist(db, people);
        replaceVideoPeople(db, videoId, people);
      }

      if (tags !== null) {
        const tagIds = ensureTagsExist(db, tags);
        replaceVideoTags(db, videoId, tagIds);
      }
    });

    applyUpdate();

    const updatedVideo = db
      .prepare("SELECT * FROM videos WHERE id = ?")
      .get(videoId);
    return res.json({ data: attachPeopleAndTags(db, [updatedVideo])[0] });
  } catch (error) {
    if (isBadRequestError(error)) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message === "Invalid video id") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    const db = getDb();
    const videoId = normalizeVideoId(req.params.id);
    const result = db
      .prepare(
        `
      UPDATE videos
      SET deleted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND deleted_at IS NULL
    `,
      )
      .run(videoId);

    if (result.changes === 0) {
      const video = db
        .prepare("SELECT id FROM videos WHERE id = ?")
        .get(videoId);

      if (!video) {
        return res.status(404).json({ error: "Video not found" });
      }
    }

    return res.json({ data: { success: true } });
  } catch (error) {
    if (error.message === "Invalid video id") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.post("/:id/suggest-location", async (req, res) => {
  try {
    const db = getDb();
    const videoId = normalizeVideoId(req.params.id);
    const video = db
      .prepare(
        `
      SELECT *
      FROM videos
      WHERE id = ?
        AND deleted_at IS NULL
    `,
      )
      .get(videoId);

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    const destinations = db
      .prepare(
        `
      SELECT city, country, date_start, date_end, duration_days
      FROM destinations
      ORDER BY date_start ASC
    `,
      )
      .all();

    const suggestion = await suggestVideoLocation(video, destinations);
    return res.json({ data: suggestion });
  } catch (error) {
    if (error.message === "Invalid video id") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

function attachPeopleAndTags(db, videos) {
  if (videos.length === 0) {
    return videos;
  }

  const videoIds = videos.map((video) => video.id);
  const placeholders = createPlaceholders(videoIds.length);
  const peopleRows = db
    .prepare(
      `
    SELECT video_people.video_id, people.id, people.name
    FROM video_people
    INNER JOIN people ON people.id = video_people.person_id
    WHERE video_people.video_id IN (${placeholders})
    ORDER BY people.name
  `,
    )
    .all(...videoIds);
  const tagRows = db
    .prepare(
      `
    SELECT video_tags.video_id, tags.id, tags.name
    FROM video_tags
    INNER JOIN tags ON tags.id = video_tags.tag_id
    WHERE video_tags.video_id IN (${placeholders})
    ORDER BY tags.name
  `,
    )
    .all(...videoIds);

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
    tags: tagsMap.get(video.id) || [],
  }));
}

function findExistingYoutubeIds(db, youtubeIds) {
  if (youtubeIds.length === 0) {
    return new Set();
  }

  const placeholders = createPlaceholders(youtubeIds.length);
  const rows = db
    .prepare(
      `
    SELECT youtube_id
    FROM videos
    WHERE youtube_id IN (${placeholders})
  `,
    )
    .all(...youtubeIds);

  return new Set(rows.map((row) => row.youtube_id));
}

function normalizeVideoId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid video id");
  }

  return id;
}

function normalizeIdArray(values) {
  if (!Array.isArray(values)) {
    throw new Error("Expected an array of positive integer ids");
  }

  const ids = values.map((value) => Number(value));

  if (ids.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error("Expected an array of positive integer ids");
  }

  return [...new Set(ids)];
}

function normalizeTagNames(values) {
  if (!Array.isArray(values)) {
    throw new Error("Expected an array of tag names");
  }

  return [
    ...new Set(values.map((value) => String(value).trim()).filter(Boolean)),
  ];
}

function createPlaceholders(count) {
  return new Array(count).fill("?").join(", ");
}

function addScalarUpdate(updates, params, payload, field) {
  if (Object.prototype.hasOwnProperty.call(payload, field)) {
    updates.push(`${field} = ?`);
    params.push(payload[field] || null);
  }
}

function validateVideoPayload(payload) {
  if (Object.prototype.hasOwnProperty.call(payload, "video_type")) {
    const validVideoTypes = new Set(["short", "longform"]);

    if (!validVideoTypes.has(payload.video_type)) {
      throw new Error("video_type must be 'short' or 'longform'");
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "video_category")) {
    const validVideoCategories = new Set([
      "travel",
      "sponsored",
      "review",
      "other",
    ]);

    if (!validVideoCategories.has(payload.video_category)) {
      throw new Error(
        "video_category must be one of: travel, sponsored, review, other",
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "date_filmed_source")) {
    const validDateSources = new Set([
      "none",
      "manual",
      "ai_suggested",
      "confirmed",
    ]);

    if (!validDateSources.has(payload.date_filmed_source)) {
      throw new Error(
        "date_filmed_source must be one of: none, manual, ai_suggested, confirmed",
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "filmed_location_source")) {
    const validLocationSources = new Set([
      "none",
      "manual",
      "ai_suggested",
      "confirmed",
    ]);

    if (!validLocationSources.has(payload.filmed_location_source)) {
      throw new Error(
        "filmed_location_source must be one of: none, manual, ai_suggested, confirmed",
      );
    }
  }
}

function ensurePeopleExist(db, peopleIds) {
  if (peopleIds.length === 0) {
    return;
  }

  const placeholders = createPlaceholders(peopleIds.length);
  const rows = db
    .prepare(
      `
    SELECT id
    FROM people
    WHERE id IN (${placeholders})
  `,
    )
    .all(...peopleIds);

  if (rows.length !== peopleIds.length) {
    const existingIds = new Set(rows.map((row) => row.id));
    const missingIds = peopleIds.filter((id) => !existingIds.has(id));
    throw new Error(`Unknown people ids: ${missingIds.join(", ")}`);
  }
}

function replaceVideoPeople(db, videoId, peopleIds) {
  db.prepare("DELETE FROM video_people WHERE video_id = ?").run(videoId);

  if (peopleIds.length === 0) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO video_people (video_id, person_id)
    VALUES (?, ?)
  `);

  for (const personId of peopleIds) {
    insert.run(videoId, personId);
  }
}

function replaceVideoTags(db, videoId, tagIds) {
  db.prepare("DELETE FROM video_tags WHERE video_id = ?").run(videoId);

  if (tagIds.length === 0) {
    return;
  }

  const insert = db.prepare(`
    INSERT INTO video_tags (video_id, tag_id)
    VALUES (?, ?)
  `);

  for (const tagId of tagIds) {
    insert.run(videoId, tagId);
  }
}

function ensureTagsExist(db, tagNames) {
  if (tagNames.length === 0) {
    return [];
  }

  const insert = db.prepare(`
    INSERT INTO tags (name)
    VALUES (?)
    ON CONFLICT(name) DO NOTHING
  `);

  for (const tagName of tagNames) {
    insert.run(tagName);
  }

  return findTagIdsByNames(db, tagNames);
}

function findTagIdsByNames(db, tagNames) {
  if (tagNames.length === 0) {
    return [];
  }

  const placeholders = createPlaceholders(tagNames.length);
  const rows = db
    .prepare(
      `
    SELECT id, name
    FROM tags
    WHERE name IN (${placeholders})
  `,
    )
    .all(...tagNames);
  const idByName = new Map(rows.map((row) => [row.name, row.id]));

  return tagNames
    .map((tagName) => idByName.get(tagName))
    .filter((tagId) => Number.isInteger(tagId));
}

function isBadRequestError(error) {
  return (
    error.message.startsWith("Expected an array of") ||
    error.message.startsWith("Unknown people ids:") ||
    error.message.startsWith("video_type must be") ||
    error.message.startsWith("video_category must be") ||
    error.message.startsWith("date_filmed_source must be") ||
    error.message.startsWith("filmed_location_source must be")
  );
}

async function suggestVideoLocation(video, destinations) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Missing required environment variable: ANTHROPIC_API_KEY");
  }

  const prompt = [
    "You are helping classify a family travel video.",
    "Suggest the most likely filmed city, filmed country, filming start date, and filming end date.",
    "Use clues in the title and description, cross-reference against the known destinations, and prefer conservative guesses.",
    "Return only valid JSON with this exact shape:",
    '{"filmed_city": string|null, "filmed_country": string|null, "date_filmed": string|null, "date_filmed_end": string|null, "confidence": string, "reasoning": string}',
    "",
    `Video title: ${video.title || ""}`,
    `Video description: ${video.description || ""}`,
    `Date published: ${video.date_published || ""}`,
    "",
    "Known destinations:",
    JSON.stringify(destinations, null, 2),
  ].join("\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error?.message || "Anthropic API request failed");
  }

  const text = extractTextFromAnthropicResponse(data);

  if (!text) {
    throw new Error("Anthropic response did not include suggestion text");
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("Anthropic returned invalid JSON for location suggestion");
  }
}

function extractTextFromAnthropicResponse(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  return blocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

module.exports = router;
