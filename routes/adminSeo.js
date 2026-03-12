const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const SeoMeta = require('../models/SeoMeta');
const Category = require('../models/Category');
const SubCategory = require('../models/SubCategory');
const Product = require('../models/Product');
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
    pageKey,
    targetType: pageType,
    targetId: item.targetId ? String(item.targetId) : undefined,
    staticKey: pageType === 'static' ? pageKey : undefined
  };
}

function parseIdentity(payload) {
  const body = payload || {};
  const targetType = body.targetType || body.pageType;
  if (!VALID_PAGE_TYPES.includes(targetType)) {
    return { error: 'Invalid pageType' };
  }

  if (targetType === 'static') {
    const staticKey = String(body.staticKey || body.pageKey || '').trim();
    if (!staticKey) return { error: 'pageKey is required for static pages' };
    return {
      targetType,
      staticKey,
      legacyPageKey: staticKey
    };
  }

  const rawTargetId = body.targetId || body.pageKey;
  const targetIdStr = String(rawTargetId || '').trim();
  if (!targetIdStr) return { error: 'pageKey is required for dynamic pages' };
  if (!mongoose.Types.ObjectId.isValid(targetIdStr)) {
    return { error: 'pageKey must be a valid id for dynamic pages' };
  }

  return {
    targetType,
    targetId: new mongoose.Types.ObjectId(targetIdStr),
    targetIdStr,
    legacyPageKey: targetIdStr
  };
}

function matchFromIdentity(identity) {
  if (identity.targetType === 'static') {
    return {
      $or: [
        { targetType: 'static', staticKey: identity.staticKey },
        { pageType: 'static', pageKey: identity.staticKey }
      ]
    };
  }
  return {
    $or: [
      { targetType: identity.targetType, targetId: identity.targetId },
      { pageType: identity.targetType, pageKey: identity.targetIdStr }
    ]
  };
}

// GET /api/admin/seo - list all SEO entries, optionally filter by pageType
router.get('/', adminAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.pageType) {
      if (!VALID_PAGE_TYPES.includes(req.query.pageType)) {
        return res.status(400).json({ message: 'Invalid pageType' });
      }
      filter.$or = [{ targetType: req.query.pageType }, { pageType: req.query.pageType }];
    }

    const items = await SeoMeta.find(filter).sort({ targetType: 1, staticKey: 1, pageType: 1, pageKey: 1, createdAt: 1 });
    return res.json({ items: items.map(toPublicItem) });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list SEO' });
  }
});

// GET /api/admin/seo/context - categories, subcategories, products for dropdowns/labels
router.get('/context', adminAuth, async (req, res) => {
  try {
    const [categories, subcategories, products] = await Promise.all([
      Category.find({ active: true }).sort({ title: 1 }).select('_id title'),
      SubCategory.find({ active: true }).populate('category', 'title').sort({ title: 1 }).select('_id title category'),
      Product.find({ active: true }).populate('subCategory', 'title').sort({ title: 1 }).select('_id title subCategory')
    ]);
    return res.json({
      categories,
      subcategories,
      products
    });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to load context' });
  }
});

// PUT /api/admin/seo/upsert - create or update by pageType+pageKey
router.put('/upsert', adminAuth, async (req, res) => {
  try {
    const { metaTitle, metaDescription, metaKeywords } = req.body || {};
    const identity = parseIdentity(req.body);
    if (identity.error) return res.status(400).json({ message: identity.error });

    let item = await SeoMeta.findOne(matchFromIdentity(identity));
    if (item) {
      item.targetType = identity.targetType;
      item.pageType = identity.targetType;
      if (identity.targetType === 'static') {
        item.staticKey = identity.staticKey;
        item.pageKey = identity.legacyPageKey;
        item.targetId = undefined;
      } else {
        item.targetId = identity.targetId;
        item.pageKey = identity.legacyPageKey;
        item.staticKey = undefined;
      }
      if (metaTitle !== undefined) item.metaTitle = String(metaTitle || '').trim();
      if (metaDescription !== undefined) item.metaDescription = String(metaDescription || '').trim();
      if (metaKeywords !== undefined) item.metaKeywords = String(metaKeywords || '').trim();
      await item.save();
      return res.json({ item: toPublicItem(item) });
    }
    item = await SeoMeta.create({
      pageType: identity.targetType,
      pageKey: identity.legacyPageKey,
      targetType: identity.targetType,
      targetId: identity.targetType === 'static' ? undefined : identity.targetId,
      staticKey: identity.targetType === 'static' ? identity.staticKey : undefined,
      metaTitle: metaTitle || '',
      metaDescription: metaDescription || '',
      metaKeywords: metaKeywords || ''
    });
    return res.status(201).json({ item: toPublicItem(item) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'SEO entry already exists for this page' });
    }
    return res.status(500).json({ message: 'Failed to upsert SEO' });
  }
});

// POST /api/admin/seo - create new SEO entry
router.post('/', adminAuth, async (req, res) => {
  try {
    const { metaTitle, metaDescription, metaKeywords } = req.body || {};
    const identity = parseIdentity(req.body);
    if (identity.error) return res.status(400).json({ message: identity.error });

    const exists = await SeoMeta.findOne(matchFromIdentity(identity));
    if (exists) {
      return res.status(409).json({ message: 'SEO entry already exists for this page' });
    }

    const item = await SeoMeta.create({
      pageType: identity.targetType,
      pageKey: identity.legacyPageKey,
      targetType: identity.targetType,
      targetId: identity.targetType === 'static' ? undefined : identity.targetId,
      staticKey: identity.targetType === 'static' ? identity.staticKey : undefined,
      metaTitle: metaTitle || '',
      metaDescription: metaDescription || '',
      metaKeywords: metaKeywords || ''
    });

    return res.status(201).json({ item: toPublicItem(item) });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'SEO entry already exists for this page' });
    }
    return res.status(500).json({ message: 'Failed to create SEO entry' });
  }
});

// PUT /api/admin/seo/:id - update
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const item = await SeoMeta.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'SEO entry not found' });

    const { metaTitle, metaDescription, metaKeywords } = req.body || {};
    if (metaTitle !== undefined) item.metaTitle = String(metaTitle || '').trim();
    if (metaDescription !== undefined) item.metaDescription = String(metaDescription || '').trim();
    if (metaKeywords !== undefined) item.metaKeywords = String(metaKeywords || '').trim();

    await item.save();
    return res.json({ item: toPublicItem(item) });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to update SEO entry' });
  }
});

// DELETE /api/admin/seo/:id - delete (e.g. remove SEO from a product)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const item = await SeoMeta.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'SEO entry not found' });

    await SeoMeta.deleteOne({ _id: item._id });
    return res.json({ message: 'SEO entry deleted' });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to delete SEO entry' });
  }
});

module.exports = router;
