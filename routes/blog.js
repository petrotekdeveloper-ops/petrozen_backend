const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const Blog = require('../models/blog');
const { filePathFromPublicUrl, uploadedFileUrl, tryDeleteFile, uploadArrayFor } = require('../utils/uploads');

const router = express.Router();

const MAX_IMAGES = 15;

function itemImageUrls(item) {
  if (!item) return [];
  const imgs = item.images;
  return Array.isArray(imgs) ? imgs.filter(Boolean) : [];
}

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

// POST /api/blog (admin) – multipart: title, description, images? (0–15 files)
router.post('/', adminAuth, uploadArrayFor('blog', 'images', MAX_IMAGES), async (req, res) => {
  try {
    const { title, description } = req.body || {};
    if (!title) return res.status(400).json({ message: 'title is required' });
    if (!description) return res.status(400).json({ message: 'description is required' });

    const files = Array.isArray(req.files) ? req.files : [];
    const imageUrls = files.map((f) => uploadedFileUrl(f)).filter(Boolean);

    const item = await Blog.create({
      title,
      description,
      images: imageUrls
    });

    return res.status(201).json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create blog' });
  }
});

// PUT /api/blog/:id (admin) – multipart: title?, description?, existingImages? (JSON array of URLs to keep), images? (new files)
router.put('/:id', adminAuth, uploadArrayFor('blog', 'images', MAX_IMAGES), async (req, res) => {
  try {
    const item = await Blog.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Blog not found' });

    const { title, description } = req.body || {};
    if (title !== undefined) item.title = title;
    if (description !== undefined) item.description = description;

    const prevUrls = itemImageUrls(item);
    const newFiles = Array.isArray(req.files) ? req.files : [];
    const newUrls = newFiles.map((f) => uploadedFileUrl(f)).filter(Boolean);

    let keepUrls = prevUrls;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'existingImages')) {
      const raw = req.body.existingImages;
      if (raw != null && raw !== '') {
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed)) {
            const allowed = new Set(prevUrls);
            keepUrls = parsed.filter((u) => typeof u === 'string' && allowed.has(u));
          }
        } catch (_) {
          keepUrls = prevUrls;
        }
      } else {
        keepUrls = [];
      }
    }

    const nextUrls = [...keepUrls, ...newUrls];
    if (nextUrls.length > MAX_IMAGES) {
      for (const u of newUrls) tryDeleteFile(filePathFromPublicUrl(u));
      return res.status(400).json({ message: `Maximum ${MAX_IMAGES} images per blog` });
    }

    const nextSet = new Set(nextUrls);
    for (const url of prevUrls) {
      if (!nextSet.has(url)) tryDeleteFile(filePathFromPublicUrl(url));
    }

    item.images = nextUrls;
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

    const urls = itemImageUrls(item);
    await Blog.deleteOne({ _id: item._id });
    for (const url of urls) tryDeleteFile(filePathFromPublicUrl(url));

    return res.json({ message: 'Blog deleted' });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to delete blog' });
  }
});

module.exports = router;
