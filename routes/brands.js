const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const Brand = require('../models/brand');
const { filePathFromPublicUrl, uploadedFileUrl, tryDeleteFile, uploadSingleFor } = require('../utils/uploads');

const router = express.Router();

// GET /api/brands – list all brands (public)
router.get('/', async (req, res) => {
  try {
    const brands = await Brand.find().sort({ name: 1 });
    return res.json({ items: brands });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list brands' });
  }
});

// GET /api/brands/:id – get one brand (public)
router.get('/:id', async (req, res) => {
  try {
    const item = await Brand.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Brand not found' });
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: 'Invalid brand id' });
  }
});

// POST /api/brands (admin) multipart/form-data: name, image
router.post('/', adminAuth, uploadSingleFor('brands', 'image'), async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'name is required' });
    }

    const imageUrl = uploadedFileUrl(req.file);
    if (!imageUrl) {
      return res.status(400).json({ message: 'image is required' });
    }

    const item = await Brand.create({
      name: String(name).trim(),
      image: imageUrl
    });

    return res.status(201).json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create brand' });
  }
});

// PUT /api/brands/:id (admin) multipart/form-data: name?, image?
router.put('/:id', adminAuth, uploadSingleFor('brands', 'image'), async (req, res) => {
  try {
    const item = await Brand.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Brand not found' });

    const { name } = req.body || {};
    if (name !== undefined) item.name = String(name).trim();

    if (req.file) {
      const oldPath = filePathFromPublicUrl(item.image);
      item.image = uploadedFileUrl(req.file);
      tryDeleteFile(oldPath);
    }

    await item.save();
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to update brand' });
  }
});

// DELETE /api/brands/:id (admin)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const item = await Brand.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Brand not found' });

    const oldPath = filePathFromPublicUrl(item.image);
    await Brand.deleteOne({ _id: item._id });
    tryDeleteFile(oldPath);

    return res.json({ message: 'Brand deleted' });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to delete brand' });
  }
});

module.exports = router;
