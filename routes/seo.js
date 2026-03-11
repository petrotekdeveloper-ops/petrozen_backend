const express = require('express');
const SeoMeta = require('../models/SeoMeta');

const router = express.Router();

// GET /api/seo - list all (public, for frontend)
router.get('/', async (req, res) => {
  try {
    const items = await SeoMeta.find({}).sort({ pageType: 1, pageKey: 1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch SEO data' });
  }
});

// GET /api/seo/:pageType/:pageKey - get one (e.g. /api/seo/static/home)
router.get('/:pageType/:pageKey', async (req, res) => {
  try {
    const { pageType, pageKey } = req.params;
    const validTypes = ['static', 'category', 'subcategory', 'product'];
    if (!validTypes.includes(pageType)) {
      return res.status(400).json({ message: 'Invalid pageType' });
    }

    const item = await SeoMeta.findOne({ pageType, pageKey });
    if (!item) return res.status(404).json({ message: 'SEO not found for this page' });
    return res.json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch SEO' });
  }
});

module.exports = router;
