const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const Blog = require('../models/blog');
const { filePathFromPublicUrl, uploadedFileUrl, tryDeleteFile, uploadSingleFor } = require('../utils/uploads');

const router = express.Router();

// GET /api/blog – list all blogs (newest first)
router.get('/', async (req, res) => {
  try {
    const items = await Blog.find().sort({ createdAt: -1 });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list blogs' });
  }
});

// GET /api/blog/:id
router.get('/:id', async (req, res) => {
  try {
    const item = await Blog.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Blog not found' });
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: 'Invalid blog id' });
  }
});

// POST /api/blog (admin) – multipart/form-data: title, description, image
router.post('/', adminAuth, uploadSingleFor('blog'), async (req, res) => {
  try {
    const { title, description } = req.body || {};
    if (!title) return res.status(400).json({ message: 'title is required' });
    if (!description) return res.status(400).json({ message: 'description is required' });
    if (!req.file) return res.status(400).json({ message: 'image is required' });

    const imageUrl = uploadedFileUrl(req.file);

    const item = await Blog.create({
      title,
      description,
      image: imageUrl
    });

    return res.status(201).json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create blog' });
  }
});

// PUT /api/blog/:id (admin) – multipart/form-data: title?, description?, image?
router.put('/:id', adminAuth, uploadSingleFor('blog'), async (req, res) => {
  try {
    const item = await Blog.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Blog not found' });

    const { title, description } = req.body || {};
    if (title !== undefined) item.title = title;
    if (description !== undefined) item.description = description;

    if (req.file) {
      const oldPath = filePathFromPublicUrl(item.image);
      item.image = uploadedFileUrl(req.file);
      tryDeleteFile(oldPath);
    }

    await item.save();
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to update blog' });
  }
});

// DELETE /api/blog/:id (admin)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const item = await Blog.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Blog not found' });

    await Blog.deleteOne({ _id: item._id });
    tryDeleteFile(filePathFromPublicUrl(item.image));

    return res.json({ message: 'Blog deleted' });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to delete blog' });
  }
});

module.exports = router;
