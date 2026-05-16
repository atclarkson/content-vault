const express = require("express");
const { getDb } = require("../lib/db");

const router = express.Router();

const TAG_SELECT = `
  SELECT
    tags.*,
    tag_groups.name AS group_name,
    tag_groups.color AS group_color,
    (
      SELECT COUNT(*)
      FROM photo_tags
      WHERE photo_tags.tag_id = tags.id
    ) AS photo_count,
    (
      SELECT COUNT(*)
      FROM video_tags
      WHERE video_tags.tag_id = tags.id
    ) AS video_count
  FROM tags
  LEFT JOIN tag_groups ON tag_groups.id = tags.group_id
`;

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const orderByClause = req.query.sort === "count"
      ? "ORDER BY (photo_count + video_count) DESC, LOWER(tags.name) ASC"
      : "ORDER BY LOWER(tags.name) ASC";
    const tags = db.prepare(`
      ${TAG_SELECT}
      ${orderByClause}
    `).all();

    return res.json({ data: tags });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/", (req, res) => {
  try {
    const db = getDb();
    const payload = req.body || {};
    const name = normalizeTagName(payload.name);
    const groupId = normalizeOptionalGroupId(payload.group_id);

    if (groupId !== null) {
      ensureGroupExists(db, groupId);
    }

    const existingTag = findTagByName(db, name);

    if (existingTag) {
      return res.json({ data: existingTag });
    }

    const result = db.prepare(`
      INSERT INTO tags (name, group_id)
      VALUES (?, ?)
    `).run(name, groupId);

    const createdTag = getTagById(db, result.lastInsertRowid);
    return res.status(201).json({ data: createdTag });
  } catch (error) {
    if (
      error.message === "Tag name must be a non-empty string"
      || error.message === "Invalid group id"
      || error.message === "Tag group not found"
    ) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.post("/merge", (req, res) => {
  try {
    const db = getDb();
    const sourceId = normalizeTagId(req.body?.source_id);
    const targetId = normalizeTagId(req.body?.target_id);

    if (sourceId === targetId) {
      return res.status(400).json({ error: "source_id and target_id must be different" });
    }

    const sourceTag = db.prepare("SELECT id FROM tags WHERE id = ?").get(sourceId);
    const targetTag = db.prepare("SELECT id FROM tags WHERE id = ?").get(targetId);

    if (!sourceTag || !targetTag) {
      return res.status(404).json({ error: "Source or target tag not found" });
    }

    const movedPhotos = db.prepare(`
      SELECT COUNT(*) AS count
      FROM photo_tags
      WHERE tag_id = ?
    `).get(sourceId).count;
    const movedVideos = db.prepare(`
      SELECT COUNT(*) AS count
      FROM video_tags
      WHERE tag_id = ?
    `).get(sourceId).count;

    const mergeTags = db.transaction(() => {
      db.prepare(`
        INSERT OR IGNORE INTO photo_tags (photo_id, tag_id)
        SELECT photo_id, ?, created_at
        FROM photo_tags
        WHERE tag_id = ?
      `).run(targetId, sourceId);

      db.prepare(`
        INSERT OR IGNORE INTO video_tags (video_id, tag_id)
        SELECT video_id, ?, created_at
        FROM video_tags
        WHERE tag_id = ?
      `).run(targetId, sourceId);

      db.prepare("DELETE FROM tags WHERE id = ?").run(sourceId);
    });

    mergeTags();

    return res.json({
      data: {
        success: true,
        moved_photos: movedPhotos,
        moved_videos: movedVideos
      }
    });
  } catch (error) {
    if (error.message === "Invalid tag id") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    const db = getDb();
    const tagId = normalizeTagId(req.params.id);
    const existingTag = db.prepare("SELECT * FROM tags WHERE id = ?").get(tagId);

    if (!existingTag) {
      return res.status(404).json({ error: "Tag not found" });
    }

    const payload = req.body || {};
    const updates = [];
    const params = [];

    if (Object.prototype.hasOwnProperty.call(payload, "name")) {
      const normalizedName = normalizeTagName(payload.name);
      const conflictingTag = db.prepare(`
        SELECT id
        FROM tags
        WHERE LOWER(name) = LOWER(?)
          AND id != ?
      `).get(normalizedName, tagId);

      if (conflictingTag) {
        return res.status(409).json({ error: "Tag already exists" });
      }

      updates.push("name = ?");
      params.push(normalizedName);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "color")) {
      updates.push("color = ?");
      params.push(payload.color ? String(payload.color).trim() : null);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "group_id")) {
      const groupId = normalizeOptionalGroupId(payload.group_id);

      if (groupId !== null) {
        ensureGroupExists(db, groupId);
      }

      updates.push("group_id = ?");
      params.push(groupId);
    }

    if (updates.length > 0) {
      params.push(tagId);
      db.prepare(`
        UPDATE tags
        SET ${updates.join(", ")}
        WHERE id = ?
      `).run(...params);
    }

    return res.json({ data: getTagById(db, tagId) });
  } catch (error) {
    if (
      error.message === "Invalid tag id"
      || error.message === "Tag name must be a non-empty string"
      || error.message === "Invalid group id"
      || error.message === "Tag group not found"
    ) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    const db = getDb();
    const tagId = normalizeTagId(req.params.id);
    const existingTag = db.prepare("SELECT id FROM tags WHERE id = ?").get(tagId);

    if (!existingTag) {
      return res.status(404).json({ error: "Tag not found" });
    }

    const hadPhotos = db.prepare(`
      SELECT COUNT(*) AS count
      FROM photo_tags
      WHERE tag_id = ?
    `).get(tagId).count;
    const hadVideos = db.prepare(`
      SELECT COUNT(*) AS count
      FROM video_tags
      WHERE tag_id = ?
    `).get(tagId).count;

    db.prepare("DELETE FROM tags WHERE id = ?").run(tagId);

    return res.json({
      data: {
        success: true,
        had_photos: hadPhotos,
        had_videos: hadVideos
      }
    });
  } catch (error) {
    if (error.message === "Invalid tag id") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

function getTagById(db, tagId) {
  return db.prepare(`
    ${TAG_SELECT}
    WHERE tags.id = ?
  `).get(tagId);
}

function findTagByName(db, name) {
  const existingTag = db.prepare(`
    SELECT id
    FROM tags
    WHERE LOWER(name) = LOWER(?)
    LIMIT 1
  `).get(name);

  if (!existingTag) {
    return null;
  }

  return getTagById(db, existingTag.id);
}

function ensureGroupExists(db, groupId) {
  const group = db.prepare("SELECT id FROM tag_groups WHERE id = ?").get(groupId);

  if (!group) {
    throw new Error("Tag group not found");
  }
}

function normalizeTagId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid tag id");
  }

  return id;
}

function normalizeOptionalGroupId(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const groupId = Number(value);

  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw new Error("Invalid group id");
  }

  return groupId;
}

function normalizeTagName(value) {
  if (typeof value !== "string") {
    throw new Error("Tag name must be a non-empty string");
  }

  const name = value.trim().toLowerCase();

  if (!name) {
    throw new Error("Tag name must be a non-empty string");
  }

  return name;
}

module.exports = router;
