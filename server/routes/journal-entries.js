const express = require("express");
const { getDb, initializeDatabase } = require("../lib/db");
const { queryJournals } = require("../lib/journalQuery");
const { isMissingTableError, isQueryBadRequestError, tableExists } = require("../lib/queryUtils");

initializeDatabase();

const router = express.Router();

router.post("/query", (req, res) => {
  try {
    const db = getDb();
    const result = queryJournals(db, req.body || {});
    return res.json({
      data: {
        items: result.items,
        total: result.total,
        limit: result.limit,
        offset: result.offset
      }
    });
  } catch (error) {
    if (isMissingTableError(error)) {
      return res.json({ data: { items: [], total: 0, limit: 10, offset: 0 } });
    }

    if (isQueryBadRequestError(error)) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

router.get("/", (req, res) => {
  try {
    const db = getDb();
    if (!tableExists(db, "journal_entries")) {
      return res.json({ data: [] });
    }

    const entries = db.prepare(`
      SELECT *
      FROM journal_entries
      ORDER BY entry_date ASC, id ASC
    `).all();

    return res.json({ data: entries });
  } catch (error) {
    if (isMissingTableError(error)) {
      return res.json({ data: [] });
    }

    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
