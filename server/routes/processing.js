const express = require("express");
const { getDb } = require("../lib/db");

const router = express.Router();

router.get("/status", (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT processing_status, COUNT(*) AS count
      FROM photos
      WHERE deleted_at IS NULL
      GROUP BY processing_status
    `).all();

    const counts = {
      queued: 0,
      processing: 0,
      complete: 0,
      failed: 0,
      needs_review: 0
    };

    for (const row of rows) {
      if (Object.prototype.hasOwnProperty.call(counts, row.processing_status)) {
        counts[row.processing_status] = row.count;
      }
    }

    return res.json({ data: counts });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
