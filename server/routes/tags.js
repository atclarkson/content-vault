const express = require("express");
const router = express.Router();
const { getDb } = require("../lib/db");

router.get("/", (req, res) => {
  try {
    const db = getDb();
    const tags = db.prepare("SELECT * FROM tags ORDER BY name").all();
    res.json({ data: tags });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
