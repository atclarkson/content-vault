const express = require("express");
const router = express.Router();
const { getDb } = require("../lib/db");

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const people = db.prepare("SELECT * FROM people ORDER BY name").all();
    res.json({ data: people });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
    if (error.message === "Name must be a non-empty string" || error.message === "Name must be 100 characters or fewer") {
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

module.exports = router;
