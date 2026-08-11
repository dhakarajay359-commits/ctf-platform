const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Load payloads data once
const payloadsPath = path.join(__dirname, '../data/payloads.json');
let payloads = [];

try {
  if (fs.existsSync(payloadsPath)) {
    payloads = JSON.parse(fs.readFileSync(payloadsPath, 'utf8'));
  }
} catch (err) {
  console.error('Failed to load payloads.json:', err);
}

// GET /api/payloads
router.get('/', (req, res) => {
  res.json(payloads);
});

module.exports = router;
