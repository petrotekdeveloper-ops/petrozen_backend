const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const Category = require('../models/Category');
const SubCategory = require('../models/SubCategory');
const Product = require('../models/Product');
const { parseBool, filePathFromPublicUrl, tryDeleteFile, uploadFor } = require('../utils/uploads');

const router = express.Router();

// GET /api/categories?active=true|false
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.active !== undefined) filter.active = parseBool(req.query.active, true);

    const categories = await Category.find(filter).sort({ createdAt: -1 });
    return res.json({ items: categories });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list categories' });
  }
});

// GET /api/categories/:id
router.get('/:id', async (req, res) => {
  try {
    const item = await Category.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Category not found' });
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: 'Invalid category id' });
  }
});

// POST /api/categories (admin) multipart/form-data: title, description?, active?, image?
router.post('/', adminAuth, uploadFor('categories').single('image'), async (req, res) => {
  try {
    const { title, description } = req.body || {};
    if (!title) return res.status(400).json({ message: 'title is required' });

    const active = parseBool(req.body?.active, true);
    const imageUrl = req.file ? `/uploads/categories/${req.file.filename}` : '';

    const item = await Category.create({
      title,
      description: description || '',
      active,
      imageUrl
    });

    return res.status(201).json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create category' });
  }
});

// PUT /api/categories/:id (admin) multipart/form-data: title?, description?, active?, image?
router.put('/:id', adminAuth, uploadFor('categories').single('image'), async (req, res) => {
  try {
    const item = await Category.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Category not found' });

    const { title, description } = req.body || {};
    if (title !== undefined) item.title = title;
    if (description !== undefined) item.description = description;
    if (req.body?.active !== undefined) item.active = parseBool(req.body.active, item.active);

    if (req.file) {
      const oldPath = filePathFromPublicUrl(item.imageUrl);
      item.imageUrl = `/uploads/categories/${req.file.filename}`;
      tryDeleteFile(oldPath);
    }

    await item.save();
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to update category' });
  }
});

// DELETE /api/categories/:id (admin) - cascades subcategories + products
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return res.status(404).json({ message: 'Category not found' });

    const subCats = await SubCategory.find({ category: category._id }, { _id: 1, imageUrl: 1 });
    const subCatIds = subCats.map((s) => s._id);

    const products = await Product.find({ subCategory: { $in: subCatIds } }, { imageUrl: 1 });

    // Delete DB records
    await Product.deleteMany({ subCategory: { $in: subCatIds } });
    await SubCategory.deleteMany({ category: category._id });
    await Category.deleteOne({ _id: category._id });

    // Best-effort delete files
    tryDeleteFile(filePathFromPublicUrl(category.imageUrl));
    subCats.forEach((s) => tryDeleteFile(filePathFromPublicUrl(s.imageUrl)));
    products.forEach((p) => tryDeleteFile(filePathFromPublicUrl(p.imageUrl)));

    return res.json({ message: 'Category deleted' });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to delete category' });
  }
});

module.exports = router;
