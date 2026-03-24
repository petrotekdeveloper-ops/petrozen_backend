const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const SubCategory = require('../models/SubCategory');
const Brand = require('../models/brand');
const Product = require('../models/Product');
const SeoMeta = require('../models/SeoMeta');
const { parseBool, filePathFromPublicUrl, uploadedFileUrl, tryDeleteFile, uploadFieldsFor } = require('../utils/uploads');

const router = express.Router();
const productUpload = uploadFieldsFor('products', [
  { name: 'image', maxCount: 1, allowImages: true, allowPdf: false },
  { name: 'catelog', maxCount: 1, allowImages: true, allowPdf: true },
  { name: 'catelouge', maxCount: 1, allowImages: true, allowPdf: true }
]);

function firstUploadedFile(req, fieldName) {
  const files = req.files && req.files[fieldName];
  if (!Array.isArray(files) || files.length === 0) return null;
  return files[0];
}

function parseStringArray(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  const raw = String(value || '').trim();
  if (!raw) return [];

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item || '').trim())
          .filter(Boolean);
      }
    } catch (_) {
      // fallback to comma-separated parsing
    }
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSortNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

// GET /api/products?subCategoryId=...&brandId=...&active=true|false
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.subCategoryId) filter.subCategory = req.query.subCategoryId;
    if (req.query.brandId) filter.brand = req.query.brandId;
    if (req.query.active !== undefined) filter.active = parseBool(req.query.active, true);

    const items = await Product.find(filter)
      .populate({ path: 'subCategory', select: 'title active', populate: { path: 'category', select: 'title active' } })
      .populate({ path: 'brand', select: 'name image' });

    items.sort((a, b) => {
      const aSort = parseSortNumber(a?.sort);
      const bSort = parseSortNumber(b?.sort);

      const aHasSort = aSort !== null;
      const bHasSort = bSort !== null;
      if (aHasSort && bHasSort && aSort !== bSort) return aSort - bSort;
      if (aHasSort && !bHasSort) return -1;
      if (!aHasSort && bHasSort) return 1;

      const aCreatedAt = new Date(a?.createdAt || 0).getTime();
      const bCreatedAt = new Date(b?.createdAt || 0).getTime();
      return aCreatedAt - bCreatedAt;
    });

    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to list products' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const item = await Product.findById(req.params.id)
      .populate({ path: 'subCategory', select: 'title active', populate: { path: 'category', select: 'title active' } })
      .populate({ path: 'brand', select: 'name image' });
    if (!item) return res.status(404).json({ message: 'Product not found' });
    return res.json({ item });
  } catch (err) {
    return res.status(400).json({ message: 'Invalid product id' });
  }
});

// POST /api/products (admin) multipart/form-data: subCategoryId, brandId?, title, description?, active?, image?
router.post('/', adminAuth, productUpload, async (req, res) => {
  try {
    const { subCategoryId, brandId, title, description, sort } = req.body || {};
    if (!subCategoryId) return res.status(400).json({ message: 'subCategoryId is required' });
    if (!title) return res.status(400).json({ message: 'title is required' });

    const sub = await SubCategory.findById(subCategoryId);
    if (!sub) return res.status(404).json({ message: 'SubCategory not found' });

    let brand = null;
    if (brandId) {
      brand = await Brand.findById(brandId);
      if (!brand) return res.status(404).json({ message: 'Brand not found' });
    }

    const active = parseBool(req.body?.active, true);
    const imageUrl = uploadedFileUrl(firstUploadedFile(req, 'image'));
    const catelog = uploadedFileUrl(firstUploadedFile(req, 'catelog') || firstUploadedFile(req, 'catelouge'));
    const features = parseStringArray(req.body?.features) || [];
    const specifications = parseStringArray(req.body?.specifications) || [];
    const grades = parseStringArray(req.body?.grades) || [];

    const item = await Product.create({
      subCategory: subCategoryId,
      brand: brandId || undefined,
      title,
      description: description || '',
      active,
      imageUrl,
      catelog,
      features,
      specifications,
      grades,
      sort: sort !== undefined ? String(sort).trim() : ''
    });

    return res.status(201).json({ item });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create product' });
  }
});

// PUT /api/products/:id (admin) multipart/form-data: subCategoryId?, brandId?, title?, description?, active?, image?
router.put('/:id', adminAuth, productUpload, async (req, res) => {
  try {
    const item = await Product.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Product not found' });

    const { subCategoryId, brandId, title, description, sort } = req.body || {};

    if (subCategoryId !== undefined) {
      const sub = await SubCategory.findById(subCategoryId);
      if (!sub) return res.status(404).json({ message: 'SubCategory not found' });
      item.subCategory = subCategoryId;
    }
    if (brandId !== undefined) {
      if (brandId) {
        const brand = await Brand.findById(brandId);
        if (!brand) return res.status(404).json({ message: 'Brand not found' });
        item.brand = brandId;
      } else {
        item.brand = null;
      }
    }
    if (title !== undefined) item.title = title;
    if (description !== undefined) item.description = description;
    if (sort !== undefined) item.sort = String(sort).trim();
    if (req.body?.active !== undefined) item.active = parseBool(req.body.active, item.active);
    if (req.body?.features !== undefined) item.features = parseStringArray(req.body.features) || [];
    if (req.body?.specifications !== undefined) item.specifications = parseStringArray(req.body.specifications) || [];
    if (req.body?.grades !== undefined) item.grades = parseStringArray(req.body.grades) || [];

    const imageFile = firstUploadedFile(req, 'image');
    if (imageFile) {
      const oldPath = filePathFromPublicUrl(item.imageUrl);
      item.imageUrl = uploadedFileUrl(imageFile);
      tryDeleteFile(oldPath);
    }

    const catelogFile = firstUploadedFile(req, 'catelog') || firstUploadedFile(req, 'catelouge');
    if (catelogFile) {
      const oldPath = filePathFromPublicUrl(item.catelog);
      item.catelog = uploadedFileUrl(catelogFile);
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

    await SeoMeta.deleteMany({
      $or: [
        { targetType: 'product', targetId: item._id },
        { pageType: 'product', pageKey: String(item._id) }
      ]
    });
    await Product.deleteOne({ _id: item._id });
    tryDeleteFile(filePathFromPublicUrl(item.imageUrl));
    tryDeleteFile(filePathFromPublicUrl(item.catelog));

    return res.json({ message: 'Product deleted' });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to delete product' });
  }
});

module.exports = router;
