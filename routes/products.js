const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const SubCategory = require('../models/SubCategory');
const Brand = require('../models/brand');
const Product = require('../models/Product');
const SeoMeta = require('../models/SeoMeta');
const { parseBool, filePathFromPublicUrl, uploadedFileUrl, tryDeleteFile, uploadFieldsFor } = require('../utils/uploads');

const router = express.Router();

const DEFAULT_VARIETY_KEYWORD = 'grade';
const MAX_PRODUCT_IMAGES = 15;

function productImageUrlsFromPlain(plain) {
  if (!plain) return [];
  const imgs = plain.images;
  if (Array.isArray(imgs) && imgs.length > 0) return imgs.filter(Boolean);
  if (plain.imageUrl) return [plain.imageUrl];
  return [];
}

function productImageUrlsFromDoc(item) {
  if (!item) return [];
  const imgs = item.images;
  if (Array.isArray(imgs) && imgs.length > 0) return imgs.filter(Boolean);
  if (item.imageUrl) return [item.imageUrl];
  return [];
}

function deleteUploadedList(urls) {
  for (const url of urls) tryDeleteFile(filePathFromPublicUrl(url));
}

/** Legacy request body: [{ keyword, grade }, ...] */
function parseLegacyVarietyRows(value) {
  if (value === undefined) return [];
  let arr;
  if (Array.isArray(value)) {
    arr = value;
  } else {
    const raw = String(value || '').trim();
    if (!raw) return [];
    try {
      arr = JSON.parse(raw);
    } catch (_) {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((entry) => ({
      keyword: String(entry?.keyword ?? DEFAULT_VARIETY_KEYWORD).trim() || DEFAULT_VARIETY_KEYWORD,
      grade: String(entry?.grade ?? '').trim()
    }))
    .filter((entry) => entry.grade);
}

function effectiveVarietyGroup(plain) {
  const vals = Array.isArray(plain.varietyValues)
    ? plain.varietyValues.map((s) => String(s ?? '').trim()).filter(Boolean)
    : [];
  if (vals.length > 0) {
    return {
      varietyKeyword:
        String(plain.varietyKeyword ?? DEFAULT_VARIETY_KEYWORD).trim() || DEFAULT_VARIETY_KEYWORD,
      varietyValues: vals
    };
  }
  const oldRows = Array.isArray(plain.varieties) ? plain.varieties : [];
  const fromRows = oldRows
    .map((v) => ({
      keyword: String(v?.keyword ?? DEFAULT_VARIETY_KEYWORD).trim() || DEFAULT_VARIETY_KEYWORD,
      grade: String(v?.grade ?? '').trim()
    }))
    .filter((v) => v.grade);
  if (fromRows.length > 0) {
    return {
      varietyKeyword: fromRows[0].keyword,
      varietyValues: fromRows.map((r) => r.grade)
    };
  }
  const legacyGrades = plain.grades;
  if (Array.isArray(legacyGrades) && legacyGrades.length > 0) {
    return {
      varietyKeyword: DEFAULT_VARIETY_KEYWORD,
      varietyValues: legacyGrades.map((g) => String(g ?? '').trim()).filter(Boolean)
    };
  }
  return { varietyKeyword: DEFAULT_VARIETY_KEYWORD, varietyValues: [] };
}

function serializeProduct(doc) {
  if (!doc) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  const v = effectiveVarietyGroup(plain);
  plain.varietyKeyword = v.varietyKeyword;
  plain.varietyValues = v.varietyValues;
  delete plain.varieties;
  delete plain.grades;
  const picUrls = productImageUrlsFromPlain(plain);
  plain.images = picUrls;
  plain.imageUrl = picUrls[0] || '';
  return plain;
}
const productUpload = uploadFieldsFor('products', [
  { name: 'image', maxCount: 1, allowImages: true, allowPdf: false },
  { name: 'images', maxCount: MAX_PRODUCT_IMAGES, allowImages: true, allowPdf: false },
  { name: 'catelog', maxCount: 1, allowImages: true, allowPdf: true },
  { name: 'catelouge', maxCount: 1, allowImages: true, allowPdf: true }
]);

function firstUploadedFile(req, fieldName) {
  const files = req.files && req.files[fieldName];
  if (!Array.isArray(files) || files.length === 0) return null;
  return files[0];
}

function uploadedFilesList(req, fieldName) {
  const files = req.files && req.files[fieldName];
  return Array.isArray(files) ? files : [];
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

    return res.json({ items: items.map((doc) => serializeProduct(doc)) });
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
    return res.json({ item: serializeProduct(item) });
  } catch (err) {
    return res.status(400).json({ message: 'Invalid product id' });
  }
});

// POST /api/products (admin) multipart: …, image? (single, legacy), images? (0–15), catelog?
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
    const multiUrls = uploadedFilesList(req, 'images').map((f) => uploadedFileUrl(f)).filter(Boolean);
    const legacyUrl = uploadedFileUrl(firstUploadedFile(req, 'image'));
    let imageUrls = multiUrls.length > 0 ? multiUrls : legacyUrl ? [legacyUrl] : [];
    if (imageUrls.length > MAX_PRODUCT_IMAGES) {
      deleteUploadedList(imageUrls);
      return res.status(400).json({ message: `Maximum ${MAX_PRODUCT_IMAGES} images per product` });
    }
    const imageUrl = imageUrls[0] || '';
    const catelog = uploadedFileUrl(firstUploadedFile(req, 'catelog') || firstUploadedFile(req, 'catelouge'));
    const features = parseStringArray(req.body?.features) || [];
    const specifications = parseStringArray(req.body?.specifications) || [];
    const applications = parseStringArray(req.body?.applications) || [];

    let varietyKeyword =
      String(req.body?.varietyKeyword ?? DEFAULT_VARIETY_KEYWORD).trim() || DEFAULT_VARIETY_KEYWORD;
    let varietyValues = [];
    if (req.body?.varietyValues !== undefined) {
      varietyValues = parseStringArray(req.body.varietyValues) || [];
    } else if (req.body?.grades !== undefined) {
      varietyValues = parseStringArray(req.body.grades) || [];
    } else if (req.body?.varieties !== undefined) {
      const rows = parseLegacyVarietyRows(req.body.varieties);
      varietyValues = rows.map((r) => r.grade);
      if (rows.length) varietyKeyword = rows[0].keyword;
    }

    const item = await Product.create({
      subCategory: subCategoryId,
      brand: brandId || undefined,
      title,
      description: description || '',
      active,
      imageUrl,
      images: imageUrls,
      catelog,
      features,
      specifications,
      applications,
      varietyKeyword,
      varietyValues,
      varieties: [],
      grades: [],
      sort: sort !== undefined ? String(sort).trim() : ''
    });

    return res.status(201).json({ item: serializeProduct(item) });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to create product' });
  }
});

// PUT /api/products/:id (admin) multipart: …, image? (legacy: replaces gallery with one), images? (append unless existingImages sent), existingImages? (JSON URLs to keep)
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
    if (req.body?.applications !== undefined) item.applications = parseStringArray(req.body.applications) || [];

    const touchesVariety =
      req.body?.varietyKeyword !== undefined ||
      req.body?.varietyValues !== undefined ||
      req.body?.varieties !== undefined ||
      req.body?.grades !== undefined;

    if (touchesVariety) {
      if (req.body?.varietyKeyword !== undefined) {
        item.varietyKeyword =
          String(req.body.varietyKeyword).trim() || DEFAULT_VARIETY_KEYWORD;
      }
      if (req.body?.varietyValues !== undefined) {
        item.varietyValues = parseStringArray(req.body.varietyValues) || [];
      } else if (req.body?.grades !== undefined) {
        item.varietyValues = parseStringArray(req.body.grades) || [];
      } else if (req.body?.varieties !== undefined) {
        const rows = parseLegacyVarietyRows(req.body.varieties);
        item.varietyValues = rows.map((r) => r.grade);
        if (rows.length) item.varietyKeyword = rows[0].keyword;
      }
      item.varieties = [];
      item.grades = [];
    }

    const prevPicUrls = productImageUrlsFromDoc(item);
    const newMultiUrls = uploadedFilesList(req, 'images').map((f) => uploadedFileUrl(f)).filter(Boolean);
    const legacyImageFile = firstUploadedFile(req, 'image');
    const hasExistingImagesKey = Object.prototype.hasOwnProperty.call(req.body || {}, 'existingImages');

    let nextPicUrls = prevPicUrls;

    if (hasExistingImagesKey) {
      let keepUrls = prevPicUrls;
      const raw = req.body.existingImages;
      if (raw != null && raw !== '') {
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed)) {
            const allowed = new Set(prevPicUrls);
            keepUrls = parsed.filter((u) => typeof u === 'string' && allowed.has(u));
          }
        } catch (_) {
          keepUrls = prevPicUrls;
        }
      } else {
        keepUrls = [];
      }
      nextPicUrls = [...keepUrls, ...newMultiUrls];
    } else if (legacyImageFile) {
      const u = uploadedFileUrl(legacyImageFile);
      nextPicUrls = u ? [u] : prevPicUrls;
    } else if (newMultiUrls.length > 0) {
      nextPicUrls = [...prevPicUrls, ...newMultiUrls];
    }

    if (nextPicUrls.length > MAX_PRODUCT_IMAGES) {
      deleteUploadedList(newMultiUrls);
      if (legacyImageFile) {
        const u = uploadedFileUrl(legacyImageFile);
        if (u) tryDeleteFile(filePathFromPublicUrl(u));
      }
      return res.status(400).json({ message: `Maximum ${MAX_PRODUCT_IMAGES} images per product` });
    }

    if (nextPicUrls !== prevPicUrls) {
      const nextSet = new Set(nextPicUrls);
      for (const url of prevPicUrls) {
        if (!nextSet.has(url)) tryDeleteFile(filePathFromPublicUrl(url));
      }
      item.images = nextPicUrls;
      item.imageUrl = nextPicUrls[0] || '';
    }

    const catelogFile = firstUploadedFile(req, 'catelog') || firstUploadedFile(req, 'catelouge');
    if (catelogFile) {
      const oldPath = filePathFromPublicUrl(item.catelog);
      item.catelog = uploadedFileUrl(catelogFile);
      tryDeleteFile(oldPath);
    }

    await item.save();
    return res.json({ item: serializeProduct(item) });
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
    for (const url of productImageUrlsFromDoc(item)) tryDeleteFile(filePathFromPublicUrl(url));
    tryDeleteFile(filePathFromPublicUrl(item.catelog));

    return res.json({ message: 'Product deleted' });
  } catch (err) {
    return res.status(400).json({ message: 'Failed to delete product' });
  }
});

module.exports = router;
