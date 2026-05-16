const express = require("express");
const { getDb } = require("../lib/db");

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const orderByClause = req.query.sort === "count"
      ? "ORDER BY (photo_count + video_count) DESC, LOWER(tags.name) ASC"
      : "ORDER BY LOWER(tags.name) ASC";
    const tags = db.prepare(`
      SELECT
        tags.*,
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
      ${orderByClause}
    `).all();

    return res.json({ data: tags });
  } catch (error) {
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
      const conflictingTag = db.prepare("SELECT id FROM tags WHERE name = ? AND id != ?").get(normalizedName, tagId);

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

    if (updates.length > 0) {
      params.push(tagId);
      db.prepare(`
        UPDATE tags
        SET ${updates.join(", ")}
        WHERE id = ?
      `).run(...params);
    }

    const updatedTag = db.prepare(`
      SELECT
        tags.*,
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
      WHERE id = ?
    `).get(tagId);

    return res.json({ data: updatedTag });
  } catch (error) {
    if (error.message === "Invalid tag id" || error.message === "Tag name must be a non-empty string") {
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

function normalizeTagId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid tag id");
  }

  return id;
}

function normalizeTagName(value) {
  if (typeof value !== "string") {
    throw new Error("Tag name must be a non-empty string");
  }

  const name = value.trim();

  if (!name) {
    throw new Error("Tag name must be a non-empty string");
  }

  return name;
}

module.exports = router;
