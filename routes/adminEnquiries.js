const express = require('express');
const ContactEnquiry = require('../models/ContactEnquiry');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();

// GET /api/admin/enquiries - list all enquiries (admin only)
router.get('/', adminAuth, async (req, res) => {
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
router.get('/:id', adminAuth, async (req, res) => {
  try {
    const item = await ContactEnquiry.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ message: 'Enquiry not found' });
    return res.json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch enquiry' });
  }
});

module.exports = router;
