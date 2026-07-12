const express = require("express");
const { getDb, initializeDatabase } = require("../lib/db");
const { searchSemanticContent } = require("../lib/semanticSearch");

initializeDatabase();

const router = express.Router();

router.post("/semantic", async (req, res) => {
  try {
    const db = getDb();
    const result = await searchSemanticContent(db, req.body || {});
    return res.json({ data: result });
  } catch (error) {
    if (
      error.message === "query is required"
      || error.message === "limit must be an integer between 1 and 50"
      || error.message === "content_types must only include photo, video, or journal"
    ) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
