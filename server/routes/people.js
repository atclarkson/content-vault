const express = require('express');
const router = express.Router();
const { getDb } = require('../lib/db');

router.get('/', (req, res) => {
  try {
    const db = getDb();
    const people = db.prepare('SELECT * FROM people ORDER BY name').all();
    res.json({ data: people });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
