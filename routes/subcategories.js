const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const Category = require('../models/Category');
const SubCategory = require('../models/SubCategory');
const Product = require('../models/Product');
const { parseBool, filePathFromPublicUrl, uploadedFileUrl, tryDeleteFile, uploadSingleFor } = require('../utils/uploads');

const router = express.Router();

// GET /api/subcategories?categoryId=...&active=true|false
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.categoryId) filter.category = req.query.categoryId;
    if (req.query.active !== undefined) filter.active = parseBool(req.query.active, true);

    const items = await SubCategory.find(filter).sort({ createdAt: -1 }).populate('category', 'title active');
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list subcategories' });
  }
});

// GET /api/subcategories/:id
router.get('/:id', async (req, res) => {
  try {
    const item = await SubCategory.findById(req.params.id).populate('category', 'title active');
    if (!item) return res.status(404).json({ message: 'SubCategory not found' });
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: 'Invalid subcategory id' });
  }
});

// POST /api/subcategories (admin) multipart/form-data: categoryId, title, description?, active?, image?
router.post('/', adminAuth, uploadSingleFor('subcategories'), async (req, res) => {
  try {
    const { categoryId, title, description } = req.body || {};
    if (!categoryId) return res.status(400).json({ message: 'categoryId is required' });
    if (!title) return res.status(400).json({ message: 'title is required' });

    const cat = await Category.findById(categoryId);
    if (!cat) return res.status(404).json({ message: 'Category not found' });

    const active = parseBool(req.body?.active, true);
    const imageUrl = uploadedFileUrl(req.file);

    const item = await SubCategory.create({
      category: categoryId,
      title,
      description: description || '',
      active,
      imageUrl
    });

    return res.status(201).json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create subcategory' });
  }
});

// PUT /api/subcategories/:id (admin) multipart/form-data: categoryId?, title?, description?, active?, image?
router.put('/:id', adminAuth, uploadSingleFor('subcategories'), async (req, res) => {
  try {
    const item = await SubCategory.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'SubCategory not found' });

    const { categoryId, title, description } = req.body || {};

    if (categoryId !== undefined) {
      const cat = await Category.findById(categoryId);
      if (!cat) return res.status(404).json({ message: 'Category not found' });
      item.category = categoryId;
    }
    if (title !== undefined) item.title = title;
    if (description !== undefined) item.description = description;
    if (req.body?.active !== undefined) item.active = parseBool(req.body.active, item.active);

    if (req.file) {
      const oldPath = filePathFromPublicUrl(item.imageUrl);
      item.imageUrl = uploadedFileUrl(req.file);
      tryDeleteFile(oldPath);
    }

    await item.save();
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to update subcategory' });
  }
});

// DELETE /api/subcategories/:id (admin) - cascades products
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const sub = await SubCategory.findById(req.params.id);
    if (!sub) return res.status(404).json({ message: 'SubCategory not found' });

    const products = await Product.find({ subCategory: sub._id }, { imageUrl: 1 });

    await Product.deleteMany({ subCategory: sub._id });
    await SubCategory.deleteOne({ _id: sub._id });

    tryDeleteFile(filePathFromPublicUrl(sub.imageUrl));
    products.forEach((p) => tryDeleteFile(filePathFromPublicUrl(p.imageUrl)));

    return res.json({ message: 'SubCategory deleted' });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to delete subcategory' });
  }
});

module.exports = router;
