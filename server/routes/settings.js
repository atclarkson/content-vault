const express = require("express");
const { getDb, initializeDatabase } = require("../lib/db");

const router = express.Router();

initializeDatabase();

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT key, value
      FROM settings
      ORDER BY key
    `).all();

    const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return res.json({ data: settings });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.put("/:key", (req, res) => {
  try {
    const db = getDb();
    const key = String(req.params.key || "").trim();
    const value = req.body?.value;

    if (!key) {
      return res.status(400).json({ error: "Setting key is required" });
    }

    if (typeof value !== "string") {
      return res.status(400).json({ error: "value must be a string" });
    }

    db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `).run(key, value);

    return res.json({ data: { key, value } });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
