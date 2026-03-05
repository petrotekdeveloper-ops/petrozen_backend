const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();

function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// POST /api/admin/login
// Body: { "username": "...", "password": "..." }
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ message: 'username and password are required' });
  }

  const envUsername = process.env.admin_username;
  const envPassword = process.env.admin_password;
  const jwtSecret = process.env.JWT_SECRET;

  if (!envUsername || !envPassword || !jwtSecret) {
    return res.status(500).json({
      message: 'Server admin credentials or JWT secret are not configured'
    });
  }

  const usernameOk = timingSafeEqualString(String(username), String(envUsername));
  const passwordOk = timingSafeEqualString(String(password), String(envPassword));

  if (!usernameOk || !passwordOk) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { role: 'admin', username: envUsername },
    jwtSecret,
    { expiresIn: '7d' }
  );

  return res.json({
    token,
    admin: { username: envUsername, role: 'admin' }
  });
});

// GET /api/admin/me
router.get('/me', adminAuth, (req, res) => {
  return res.json({ admin: req.admin });
});

module.exports = router;
