const express = require('express');
const router = express.Router();

router.get('/status', (req, res) => {
  res.json({ data: { queued: 0, processing: 0, complete: 0, failed: 0 } });
});

module.exports = router;
