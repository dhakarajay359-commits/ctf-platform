const express = require('express');
const db = require('../db');
const bcrypt = require('bcryptjs');
module.exports = function () {
  const router = express.Router();

  // Get the public registration form if it's active
  router.get('/form', async (req, res) => {
    const rows = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'live_%' OR key = 'ctf_status'").all();
    const config = {};
    rows.forEach(r => config[r.key] = r.value);
    const isActive = config.live_registration_active === '1';

    if (config.ctf_status === 'practice') {
      return res.json({
        active: false,
        title: config.live_registration_title || 'Live CTF Registration',
      });
    }

    // Check dates if set
    let withinDates = true;
    const now = Date.now();
    if (config.live_registration_start) {
      if (now < new Date(config.live_registration_start).getTime()) withinDates = false;
    }
    if (config.live_registration_end) {
      if (now > new Date(config.live_registration_end).getTime()) withinDates = false;
    }
    if (!isActive || !withinDates) {
      return res.json({
        active: false,
        title: config.live_registration_title || 'Live CTF Registration',
        registration_start: config.live_registration_start || null,
        registration_end: config.live_registration_end || null,
        ctf_start: config.live_ctf_event_start || null,
        ctf_end: config.live_ctf_event_end || null
      });
    }
    try {
      const schema = JSON.parse(config.live_registration_schema || '[]');
      res.json({
        active: true,
        title: config.live_registration_title || 'Live CTF Registration',
        description: config.live_registration_description || '',
        schema,
        registration_start: config.live_registration_start || null,
        registration_end: config.live_registration_end || null,
        ctf_start: config.live_ctf_event_start || null,
        ctf_end: config.live_ctf_event_end || null
      });
    } catch (e) {
      res.status(500).json({
        error: 'Form configuration is invalid.'
      });
    }
  });

  // Get public info for the index page banner
  router.get('/info', async (req, res) => {
    const rows = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'live_%' OR key = 'ctf_status'").all();
    const config = {};
    rows.forEach(r => config[r.key] = r.value);
    if (config.ctf_status === 'practice') {
      return res.json({ active: false });
    }
    res.json({
      title: config.live_registration_title || 'Live CTF Event',
      active: config.live_registration_active === '1',
      registration_start: config.live_registration_start || null,
      registration_end: config.live_registration_end || null,
      ctf_start: config.live_ctf_event_start || null,
      ctf_end: config.live_ctf_event_end || null
    });
  });

  // Submit the registration form
  router.post('/submit', async (req, res) => {
    const rows = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'live_registration_%' OR key = 'ctf_status'").all();
    const config = {};
    rows.forEach(r => config[r.key] = r.value);
    
    if (config.ctf_status === 'practice') {
      return res.status(403).json({
        error: 'Live registration is disabled in Practice mode.'
      });
    }

    const isActive = config.live_registration_active === '1';
    let withinDates = true;
    const now = Date.now();
    if (config.live_registration_start && now < new Date(config.live_registration_start).getTime()) withinDates = false;
    if (config.live_registration_end && now > new Date(config.live_registration_end).getTime()) withinDates = false;
    if (!isActive || !withinDates) {
      return res.status(403).json({
        error: 'Registration is currently closed.'
      });
    }
    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({
        error: 'Invalid submission data.'
      });
    }

    // Basic validation based on schema
    try {
      const schema = JSON.parse(config.live_registration_schema || '[]');
      for (const field of schema) {
        if (field.required && !data[field.label]) {
          return res.status(400).json({
            error: `Field "${field.label}" is required.`
          });
        }
      }

      // Prevent duplicates based on Email ID or Mobile Number
      const email = data['Email ID'];
      const phone = data['Mobile Number'];
      if (email || phone) {
        const allSubs = await db.prepare('SELECT data FROM live_registration_submissions').all();
        for (const sub of allSubs) {
          try {
            const parsed = JSON.parse(sub.data);
            if (email && parsed['Email ID'] === email || phone && parsed['Mobile Number'] === phone) {
              return res.status(400).json({
                error: 'A registration with this Email or Mobile Number already exists.'
              });
            }
          } catch (err) {}
        }
      }
    } catch (e) {
      console.error('Schema parsing or duplicate check error', e);
    }
    try {
      const teamName = data.teamName;
      const password = data.password;
      if (!teamName || !password || teamName.trim().length < 3 || password.length < 6) {
        return res.status(400).json({
          error: 'Team name must be 3+ characters and password 6+ characters.'
        });
      }
      const existingTeam = await db.prepare('SELECT id FROM teams WHERE name = ?').get(teamName.trim());
      if (existingTeam) {
        return res.status(409).json({
          error: 'That team name is already taken.'
        });
      }
      const hash = bcrypt.hashSync(password, 10);
      const info = await db.prepare('INSERT INTO teams (name, password_hash, operative_type, members_count, full_name) VALUES (?, ?, ?, ?, ?)').run(teamName.trim(), hash, 'Syndicate', 2, data['Full Name'] || 'Live CTF Team');
      req.session.teamId = info.lastInsertRowid;
      req.session.teamName = teamName.trim();

      // Remove credentials from data before saving to submissions table
      delete data.teamName;
      delete data.password;
      await db.prepare('INSERT INTO live_registration_submissions (data) VALUES (?)').run(JSON.stringify(data));
      res.json({
        ok: true
      });
    } catch (e) {
      res.status(500).json({
        error: 'Failed to save submission.'
      });
    }
  });
  return router;
};