const fs = require('fs');
const path = require('path');
const multer = require('multer');

const uploadsDir = path.join(__dirname, '..', 'uploads');

const SUBDIRS = ['categories', 'subcategories', 'products', 'blog'];

function ensureUploadsDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    // ignore
  }
}

function safeExt(originalname) {
  const ext = path.extname(originalname || '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) return ext;
  return '';
}

/**
 * Returns a multer instance for a specific subfolder.
 * @param {string} subdir - One of: categories, subcategories, products, blog
 */
function uploadFor(subdir) {
  const dir = path.join(uploadsDir, subdir);
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      ensureUploadsDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = safeExt(file.originalname) || '';
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}${ext}`);
    }
  });

  return multer({
    storage,
    fileFilter: (req, file, cb) => {
      if (file && typeof file.mimetype === 'string' && file.mimetype.startsWith('image/')) {
        return cb(null, true);
      }
      return cb(new Error('Only image uploads are allowed'));
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB
  });
}

/** @deprecated Use uploadFor('categories'|'subcategories'|'products'|'blog') instead */
const upload = uploadFor('categories');

function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const s = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(s)) return false;
  return defaultValue;
}

function filePathFromPublicUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  if (!imageUrl.startsWith('/uploads/')) return null;
  const relPath = imageUrl.replace(/^\/uploads\/?/, '');
  if (!relPath || relPath.includes('..') || relPath.includes('\\')) return null;
  return path.join(__dirname, '..', 'uploads', relPath);
}

function tryDeleteFile(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, () => {});
}

module.exports = {
  parseBool,
  filePathFromPublicUrl,
  tryDeleteFile,
  upload,
  uploadFor,
  uploadsDir,
  SUBDIRS
};
