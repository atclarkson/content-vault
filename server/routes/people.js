const express = require("express");
const { getDb } = require("../lib/db");

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const people = db.prepare("SELECT * FROM people ORDER BY name").all();
    return res.json({ data: people });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/", (req, res) => {
  try {
    const name = normalizeName(req.body?.name);
    const db = getDb();
    const existingPerson = db.prepare("SELECT * FROM people WHERE name = ?").get(name);

    if (existingPerson) {
      return res.status(409).json({ error: "Person already exists" });
    }

    const result = db.prepare(`
      INSERT INTO people (name)
      VALUES (?)
    `).run(name);
    const person = db.prepare("SELECT * FROM people WHERE id = ?").get(result.lastInsertRowid);

    return res.status(201).json({ data: person });
  } catch (error) {
    if (isValidationError(error)) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.put("/:id", (req, res) => {
  try {
    const db = getDb();
    const personId = normalizePersonId(req.params.id);
    const existingPerson = db.prepare("SELECT * FROM people WHERE id = ?").get(personId);

    if (!existingPerson) {
      return res.status(404).json({ error: "Person not found" });
    }

    const payload = req.body || {};
    const updates = [];
    const params = [];

    if (Object.prototype.hasOwnProperty.call(payload, "name")) {
      const normalizedName = normalizeName(payload.name);
      const conflictingPerson = db.prepare("SELECT id FROM people WHERE name = ? AND id != ?").get(normalizedName, personId);

      if (conflictingPerson) {
        return res.status(409).json({ error: "Person already exists" });
      }

      updates.push("name = ?");
      params.push(normalizedName);
    }

    addNullableStringUpdate(updates, params, payload, "birthday");
    addNullableStringUpdate(updates, params, payload, "notes");
    addNullableStringUpdate(updates, params, payload, "youtube_channel");
    addNullableStringUpdate(updates, params, payload, "instagram");
    addNullableStringUpdate(updates, params, payload, "website");

    if (updates.length > 0) {
      params.push(personId);
      db.prepare(`
        UPDATE people
        SET ${updates.join(", ")}
        WHERE id = ?
      `).run(...params);
    }

    const updatedPerson = db.prepare("SELECT * FROM people WHERE id = ?").get(personId);
    return res.json({ data: updatedPerson });
  } catch (error) {
    if (error.message === "Invalid person id") {
      return res.status(400).json({ error: error.message });
    }

    if (isValidationError(error)) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.delete("/:id", (req, res) => {
  try {
    const db = getDb();
    const personId = normalizePersonId(req.params.id);
    const existingPerson = db.prepare("SELECT id FROM people WHERE id = ?").get(personId);

    if (!existingPerson) {
      return res.status(404).json({ error: "Person not found" });
    }

    const hadPhotos = db.prepare(`
      SELECT COUNT(*) AS count
      FROM photo_people
      WHERE person_id = ?
    `).get(personId).count;
    const hadVideos = db.prepare(`
      SELECT COUNT(*) AS count
      FROM video_people
      WHERE person_id = ?
    `).get(personId).count;

    db.prepare("DELETE FROM people WHERE id = ?").run(personId);

    return res.json({
      data: {
        success: true,
        had_photos: hadPhotos,
        had_videos: hadVideos
      }
    });
  } catch (error) {
    if (error.message === "Invalid person id") {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

function normalizeName(value) {
  if (typeof value !== "string") {
    throw new Error("Name must be a non-empty string");
  }

  const name = value.trim();

  if (!name) {
    throw new Error("Name must be a non-empty string");
  }

  if (name.length > 100) {
    throw new Error("Name must be 100 characters or fewer");
  }

  return name;
}

function normalizePersonId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid person id");
  }

  return id;
}

function addNullableStringUpdate(updates, params, payload, field) {
  if (Object.prototype.hasOwnProperty.call(payload, field)) {
    updates.push(`${field} = ?`);

    if (payload[field] === null || payload[field] === undefined) {
      params.push(null);
      return;
    }

    params.push(String(payload[field]).trim() || null);
  }
}

function isValidationError(error) {
  return (
    error.message === "Name must be a non-empty string" ||
    error.message === "Name must be 100 characters or fewer"
  );
}

module.exports = router;
