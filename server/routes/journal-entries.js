const express = require("express");
const { getDb, initializeDatabase } = require("../lib/db");

initializeDatabase();

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const entries = db.prepare(`
      SELECT *
      FROM journal_entries
      ORDER BY entry_date ASC, id ASC
    `).all();

    return res.json({ data: entries });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
