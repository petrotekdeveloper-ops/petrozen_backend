const express = require('express');
const SeoMeta = require('../models/SeoMeta');
const mongoose = require('mongoose');

const router = express.Router();
const VALID_PAGE_TYPES = ['static', 'category', 'subcategory', 'product'];

function toPublicItem(itemDoc) {
  const item = itemDoc.toObject ? itemDoc.toObject() : itemDoc;
  const pageType = item.targetType || item.pageType;
  const pageKey = pageType === 'static'
    ? (item.staticKey || item.pageKey || '')
    : String(item.targetId || item.pageKey || '');

  return {
    ...item,
    pageType,
    pageKey
  };
}

// GET /api/seo - list all (public, for frontend)
router.get('/', async (req, res) => {
  try {
    const items = await SeoMeta.find({}).sort({ targetType: 1, staticKey: 1, pageType: 1, pageKey: 1, createdAt: 1 });
    return res.json({ items: items.map(toPublicItem) });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch SEO data' });
  }
});

// GET /api/seo/:pageType/:pageKey - get one (e.g. /api/seo/static/home)
router.get('/:pageType/:pageKey', async (req, res) => {
  try {
    const { pageType, pageKey } = req.params;
    if (!VALID_PAGE_TYPES.includes(pageType)) {
      return res.status(400).json({ message: 'Invalid pageType' });
    }

    const key = String(pageKey || '').trim();
    if (!key) return res.status(400).json({ message: 'Invalid pageKey' });

    let match;
    if (pageType === 'static') {
      match = {
        $or: [
          { targetType: 'static', staticKey: key },
          { pageType: 'static', pageKey: key }
        ]
      };
    } else {
      const objectIdMatch = mongoose.Types.ObjectId.isValid(key)
        ? [{ targetType: pageType, targetId: new mongoose.Types.ObjectId(key) }]
        : [];
      match = {
        $or: [
          ...objectIdMatch,
          { pageType, pageKey: key }
        ]
      };
    }

    const item = await SeoMeta.findOne(match);
    if (!item) return res.status(404).json({ message: 'SEO not found for this page' });
    return res.json({ item: toPublicItem(item) });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to fetch SEO' });
  }
});

module.exports = router;
