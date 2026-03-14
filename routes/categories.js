const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const Category = require('../models/Category');
const SubCategory = require('../models/SubCategory');
const Product = require('../models/Product');
const SeoMeta = require('../models/SeoMeta');
const { parseBool, filePathFromPublicUrl, uploadedFileUrl, tryDeleteFile, uploadSingleFor } = require('../utils/uploads');

const router = express.Router();

// GET /api/categories?active=true|false
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.active !== undefined) filter.active = parseBool(req.query.active, true);

    const categories = await Category.find(filter).sort({ sort: 1, createdAt: 1 });
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
router.post('/', adminAuth, uploadSingleFor('categories'), async (req, res) => {
  try {
    const { title, description, sort } = req.body || {};
    if (!title) return res.status(400).json({ message: 'title is required' });

    const active = parseBool(req.body?.active, true);
    const imageUrl = uploadedFileUrl(req.file);

    const item = await Category.create({
      title,
      description: description || '',
      active,
      imageUrl,
      sort: sort !== undefined ? String(sort).trim() : ''
    });

    return res.status(201).json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create category' });
  }
});

// PUT /api/categories/:id (admin) multipart/form-data: title?, description?, active?, image?
router.put('/:id', adminAuth, uploadSingleFor('categories'), async (req, res) => {
  try {
    const item = await Category.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Category not found' });

    const { title, description, sort } = req.body || {};
    if (title !== undefined) item.title = title;
    if (description !== undefined) item.description = description;
    if (sort !== undefined) item.sort = String(sort).trim();
    if (req.body?.active !== undefined) item.active = parseBool(req.body.active, item.active);

    if (req.file) {
      const oldPath = filePathFromPublicUrl(item.imageUrl);
      item.imageUrl = uploadedFileUrl(req.file);
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

    // Delete SEO for category, subcategories, products (new + legacy fields)
    const subCatIdStrings = subCatIds.map(String);
    const productIds = products.map((p) => p._id);
    const productIdStrings = productIds.map(String);
    await SeoMeta.deleteMany({
      $or: [
        { targetType: 'category', targetId: category._id },
        { pageType: 'category', pageKey: String(category._id) }
      ]
    });
    await SeoMeta.deleteMany({
      $or: [
        { targetType: 'subcategory', targetId: { $in: subCatIds } },
        { pageType: 'subcategory', pageKey: { $in: subCatIdStrings } }
      ]
    });
    await SeoMeta.deleteMany({
      $or: [
        { targetType: 'product', targetId: { $in: productIds } },
        { pageType: 'product', pageKey: { $in: productIdStrings } }
      ]
    });

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
