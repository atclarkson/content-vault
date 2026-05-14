const express = require('express');
const router = express.Router();

router.post('/', (req, res) => {
  res.json({ data: { message: 'upload route placeholder' } });
});

module.exports = router;
