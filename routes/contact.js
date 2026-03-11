const express = require('express');
const ContactEnquiry = require('../models/ContactEnquiry');

const router = express.Router();

// POST /api/contact - submit enquiry (public)
router.post('/', async (req, res) => {
  try {
    const { name, email, company, message } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ message: 'Please enter your name' });
    }
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ message: 'Please enter a valid email' });
    }
    if (!message || typeof message !== 'string' || message.trim().length < 10) {
      return res.status(400).json({ message: 'Please enter a brief message (at least 10 characters)' });
    }

    const enquiry = new ContactEnquiry({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      company: company ? String(company).trim() : '',
      message: message.trim(),
    });

    await enquiry.save();

    return res.status(201).json({
      message: 'Enquiry submitted successfully. We will get back to you soon.',
      id: enquiry._id,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to submit enquiry. Please try again.' });
  }
});

module.exports = router;
