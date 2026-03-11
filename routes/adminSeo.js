const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const SeoMeta = require('../models/SeoMeta');
const Category = require('../models/Category');
const SubCategory = require('../models/SubCategory');
const Product = require('../models/Product');

const router = express.Router();

const VALID_PAGE_TYPES = ['static', 'category', 'subcategory', 'product'];

// GET /api/admin/seo - list all SEO entries, optionally filter by pageType
router.get('/', adminAuth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.pageType) {
      if (!VALID_PAGE_TYPES.includes(req.query.pageType)) {
        return res.status(400).json({ message: 'Invalid pageType' });
      }
      filter.pageType = req.query.pageType;
    }

    const items = await SeoMeta.find(filter).sort({ pageType: 1, pageKey: 1 });
    return res.json({ items });
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
    const { pageType, pageKey, metaTitle, metaDescription, metaKeywords } = req.body || {};
    if (!pageType || !pageKey) {
      return res.status(400).json({ message: 'pageType and pageKey are required' });
    }
    if (!VALID_PAGE_TYPES.includes(pageType)) {
      return res.status(400).json({ message: 'Invalid pageType' });
    }
    const pk = String(pageKey).trim();
    if (!pk) return res.status(400).json({ message: 'pageKey cannot be empty' });

    let item = await SeoMeta.findOne({ pageType, pageKey: pk });
    if (item) {
      if (metaTitle !== undefined) item.metaTitle = String(metaTitle || '').trim();
      if (metaDescription !== undefined) item.metaDescription = String(metaDescription || '').trim();
      if (metaKeywords !== undefined) item.metaKeywords = String(metaKeywords || '').trim();
      await item.save();
      return res.json({ item });
    }
    item = await SeoMeta.create({
      pageType,
      pageKey: pk,
      metaTitle: metaTitle || '',
      metaDescription: metaDescription || '',
      metaKeywords: metaKeywords || ''
    });
    return res.status(201).json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to upsert SEO' });
  }
});

// POST /api/admin/seo - create new SEO entry
router.post('/', adminAuth, async (req, res) => {
  try {
    const { pageType, pageKey, metaTitle, metaDescription, metaKeywords } = req.body || {};

    if (!pageType || !pageKey) {
      return res.status(400).json({ message: 'pageType and pageKey are required' });
    }

    if (!VALID_PAGE_TYPES.includes(pageType)) {
      return res.status(400).json({ message: 'Invalid pageType' });
    }

    const pk = String(pageKey).trim();
    if (!pk) return res.status(400).json({ message: 'pageKey cannot be empty' });

    const exists = await SeoMeta.findOne({ pageType, pageKey: pk });
    if (exists) {
      return res.status(409).json({ message: 'SEO entry already exists for this page' });
    }

    const item = await SeoMeta.create({
      pageType,
      pageKey: pk,
      metaTitle: metaTitle || '',
      metaDescription: metaDescription || '',
      metaKeywords: metaKeywords || ''
    });

    return res.status(201).json({ item });
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
    return res.json({ item });
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
