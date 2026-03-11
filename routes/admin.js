const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const adminAuth = require('../middleware/adminAuth');
const ContactEnquiry = require('../models/ContactEnquiry');

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

// GET /api/admin/enquiries - list all enquiries (admin only)
router.get('/enquiries', adminAuth, async (req, res) => {
  try {
    const items = await ContactEnquiry.find({})
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch enquiries' });
  }
});

// GET /api/admin/enquiries/:id - get one enquiry (admin only)
router.get('/enquiries/:id', adminAuth, async (req, res) => {
  try {
    const item = await ContactEnquiry.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ message: 'Enquiry not found' });
    return res.json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch enquiry' });
  }
});

module.exports = router;
