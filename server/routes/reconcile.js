const express = require('express');
const router = express.Router();

router.post('/', (req, res) => {
  res.json({ data: { message: 'reconcile route placeholder' } });
});

module.exports = router;
