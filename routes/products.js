const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const SubCategory = require('../models/SubCategory');
const Product = require('../models/Product');
const { parseBool, filePathFromPublicUrl, tryDeleteFile, uploadFor } = require('../utils/uploads');

const router = express.Router();

// GET /api/products?subCategoryId=...&active=true|false
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.subCategoryId) filter.subCategory = req.query.subCategoryId;
    if (req.query.active !== undefined) filter.active = parseBool(req.query.active, true);

    const items = await Product.find(filter)
      .sort({ createdAt: -1 })
      .populate({ path: 'subCategory', select: 'title active', populate: { path: 'category', select: 'title active' } });

    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list products' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const item = await Product.findById(req.params.id).populate({
      path: 'subCategory',
      select: 'title active',
      populate: { path: 'category', select: 'title active' }
    });
    if (!item) return res.status(404).json({ message: 'Product not found' });
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: 'Invalid product id' });
  }
});

// POST /api/products (admin) multipart/form-data: subCategoryId, title, description?, active?, image?
router.post('/', adminAuth, uploadFor('products').single('image'), async (req, res) => {
  try {
    const { subCategoryId, title, description } = req.body || {};
    if (!subCategoryId) return res.status(400).json({ message: 'subCategoryId is required' });
    if (!title) return res.status(400).json({ message: 'title is required' });

    const sub = await SubCategory.findById(subCategoryId);
    if (!sub) return res.status(404).json({ message: 'SubCategory not found' });

    const active = parseBool(req.body?.active, true);
    const imageUrl = req.file ? `/uploads/products/${req.file.filename}` : '';

    const item = await Product.create({
      subCategory: subCategoryId,
      title,
      description: description || '',
      active,
      imageUrl
    });

    return res.status(201).json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create product' });
  }
});

// PUT /api/products/:id (admin) multipart/form-data: subCategoryId?, title?, description?, active?, image?
router.put('/:id', adminAuth, uploadFor('products').single('image'), async (req, res) => {
  try {
    const item = await Product.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Product not found' });

    const { subCategoryId, title, description } = req.body || {};

    if (subCategoryId !== undefined) {
      const sub = await SubCategory.findById(subCategoryId);
      if (!sub) return res.status(404).json({ message: 'SubCategory not found' });
      item.subCategory = subCategoryId;
    }
    if (title !== undefined) item.title = title;
    if (description !== undefined) item.description = description;
    if (req.body?.active !== undefined) item.active = parseBool(req.body.active, item.active);

    if (req.file) {
      const oldPath = filePathFromPublicUrl(item.imageUrl);
      item.imageUrl = `/uploads/products/${req.file.filename}`;
      tryDeleteFile(oldPath);
    }

    await item.save();
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to update product' });
  }
});

// DELETE /api/products/:id (admin)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const item = await Product.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Product not found' });

    await Product.deleteOne({ _id: item._id });
    tryDeleteFile(filePathFromPublicUrl(item.imageUrl));

    return res.json({ message: 'Product deleted' });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to delete product' });
  }
});

module.exports = router;
