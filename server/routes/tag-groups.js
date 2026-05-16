const express = require("express");
const { getDb } = require("../lib/db");

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const groups = db.prepare(`
      SELECT *
      FROM tag_groups
      ORDER BY sort_order ASC, LOWER(name) ASC
    `).all();

    const tags = db.prepare(`
      SELECT
        tags.id,
        tags.name,
        tags.group_id,
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
      WHERE tags.group_id IS NOT NULL
      ORDER BY LOWER(tags.name) ASC
    `).all();

    const tagsByGroupId = new Map();

    for (const tag of tags) {
      if (!tagsByGroupId.has(tag.group_id)) {
        tagsByGroupId.set(tag.group_id, []);
      }

      tagsByGroupId.get(tag.group_id).push({
        id: tag.id,
        name: tag.name,
        group_id: tag.group_id,
        photo_count: tag.photo_count,
        video_count: tag.video_count
      });
    }

    return res.json({
      data: groups.map((group) => ({
        ...group,
        tags: tagsByGroupId.get(group.id) || []
      }))
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/", (req, res) => {
  try {
    const db = getDb();
    const payload = req.body || {};
    const name = normalizeGroupName(payload.name);
    const color = normalizeGroupColor(payload.color);
    const sortOrder = normalizeSortOrder(payload.sort_order);
    const result = db.prepare(`
      INSERT INTO tag_groups (name, color, sort_order)
      VALUES (?, ?, ?)
    `).run(name, color, sortOrder);

    const group = db.prepare("SELECT * FROM tag_groups WHERE id = ?").get(result.lastInsertRowid);
    return res.status(201).json({ data: group });
  } catch (error) {
    if (
      error.message === "Group name must be a non-empty string"
      || error.message === "Group color must be a non-empty string"
      || error.message === "sort_order must be an integer"
    ) {
      return res.status(400).json({ error: error.message });
    }

    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Tag group already exists" });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    const db = getDb();
    const groupId = normalizeGroupId(req.params.id);
    const existingGroup = db.prepare("SELECT * FROM tag_groups WHERE id = ?").get(groupId);

    if (!existingGroup) {
      return res.status(404).json({ error: "Tag group not found" });
    }

    const payload = req.body || {};
    const updates = [];
    const params = [];

    if (Object.prototype.hasOwnProperty.call(payload, "name")) {
      updates.push("name = ?");
      params.push(normalizeGroupName(payload.name));
    }

    if (Object.prototype.hasOwnProperty.call(payload, "color")) {
      updates.push("color = ?");
      params.push(normalizeGroupColor(payload.color));
    }

    if (Object.prototype.hasOwnProperty.call(payload, "sort_order")) {
      updates.push("sort_order = ?");
      params.push(normalizeSortOrder(payload.sort_order));
    }

    if (updates.length > 0) {
      params.push(groupId);
      db.prepare(`
        UPDATE tag_groups
        SET ${updates.join(", ")}
        WHERE id = ?
      `).run(...params);
    }

    const updatedGroup = db.prepare("SELECT * FROM tag_groups WHERE id = ?").get(groupId);
    return res.json({ data: updatedGroup });
  } catch (error) {
    if (
      error.message === "Invalid tag group id"
      || error.message === "Group name must be a non-empty string"
      || error.message === "Group color must be a non-empty string"
      || error.message === "sort_order must be an integer"
    ) {
      return res.status(400).json({ error: error.message });
    }

    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Tag group already exists" });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    const db = getDb();
    const groupId = normalizeGroupId(req.params.id);
    const existingGroup = db.prepare("SELECT id FROM tag_groups WHERE id = ?").get(groupId);

    if (!existingGroup) {
      return res.status(404).json({ error: "Tag group not found" });
    }

    const tagCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM tags
      WHERE group_id = ?
    `).get(groupId).count;

    if (tagCount > 0) {
      return res.status(400).json({ error: "Cannot delete a tag group that still has tags" });
    }

    db.prepare("DELETE FROM tag_groups WHERE id = ?").run(groupId);

    return res.json({ data: { success: true } });
  } catch (error) {
    if (error.message === "Invalid tag group id") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

function normalizeGroupId(value) {
  const groupId = Number(value);

  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw new Error("Invalid tag group id");
  }

  return groupId;
}

function normalizeGroupName(value) {
  if (typeof value !== "string") {
    throw new Error("Group name must be a non-empty string");
  }

  const name = value.trim();

  if (!name) {
    throw new Error("Group name must be a non-empty string");
  }

  return name;
}

function normalizeGroupColor(value) {
  if (typeof value !== "string") {
    throw new Error("Group color must be a non-empty string");
  }

  const color = value.trim();

  if (!color) {
    throw new Error("Group color must be a non-empty string");
  }

  return color;
}

function normalizeSortOrder(value) {
  const sortOrder = Number(value ?? 0);

  if (!Number.isInteger(sortOrder)) {
    throw new Error("sort_order must be an integer");
  }

  return sortOrder;
}

module.exports = router;
