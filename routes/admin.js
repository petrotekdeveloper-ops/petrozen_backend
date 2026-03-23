const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const adminAuth = require('../middleware/adminAuth');
const ContactEnquiry = require('../models/ContactEnquiry');
const ChatSession = require('../models/ChatSession');

const SETTINGS_SESSION_ID = '_settings';

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

// GET /api/admin/chat-enquiries - list chatbot enquiries (stored as sessions)
router.get('/chat-enquiries', adminAuth, async (req, res) => {
  try {
    const items = await ChatSession.find({
      sessionId: { $ne: SETTINGS_SESSION_ID },
      phone: { $exists: true, $ne: '' }
    })
      .sort({ createdAt: -1 })
      .populate('productId', 'title')
      .lean();
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch chatbot enquiries' });
  }
});

// GET /api/admin/chat-enquiries/:id - get one chatbot enquiry (admin only)
router.get('/chat-enquiries/:id', adminAuth, async (req, res) => {
  try {
    const item = await ChatSession.findById(req.params.id)
      .populate('productId', 'title')
      .lean();
    if (!item || item.sessionId === SETTINGS_SESSION_ID || !item.phone) return res.status(404).json({ message: 'Chatbot enquiry not found' });
    return res.json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch chatbot enquiry' });
  }
});

// DELETE /api/admin/chat-enquiries/:id - delete one chatbot enquiry (admin only)
router.delete('/chat-enquiries/:id', adminAuth, async (req, res) => {
  try {
    const item = await ChatSession.findById(req.params.id);
    if (!item || item.sessionId === SETTINGS_SESSION_ID || !item.phone) {
      return res.status(404).json({ message: 'Chatbot enquiry not found' });
    }

    await ChatSession.deleteOne({ _id: item._id });

    return res.json({ message: 'Chatbot enquiry deleted.' });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to delete chatbot enquiry' });
  }
});

// GET /api/admin/chatbot-settings - get chatbot on/off (admin only)
router.get('/chatbot-settings', adminAuth, async (req, res) => {
  try {
    let doc = await ChatSession.findOne({ sessionId: SETTINGS_SESSION_ID }).lean();
    if (!doc || doc.enabled === undefined) {
      return res.json({ enabled: true });
    }
    return res.json({ enabled: doc.enabled !== false });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch chatbot settings' });
  }
});

// PATCH /api/admin/chatbot-settings - toggle chatbot on/off (admin only)
router.patch('/chatbot-settings', adminAuth, async (req, res) => {
  try {
    const enabled = req.body?.enabled === true || req.body?.enabled === false ? req.body.enabled : undefined;
    if (enabled === undefined) {
      return res.status(400).json({ message: 'enabled (true/false) is required' });
    }
    const doc = await ChatSession.findOneAndUpdate(
      { sessionId: SETTINGS_SESSION_ID },
      { $set: { enabled } },
      { upsert: true, new: true }
    );
    return res.json({ enabled: doc.enabled !== false });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update chatbot settings' });
  }
});

module.exports = router;
