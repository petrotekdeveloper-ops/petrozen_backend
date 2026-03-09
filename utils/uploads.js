const multer = require('multer');
const crypto = require('crypto');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const SUBDIRS = ['categories', 'subcategories', 'products', 'blog'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

function safeExt(originalname) {
  const name = String(originalname || '');
  const dotIndex = name.lastIndexOf('.');
  const ext = dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
  if (IMAGE_EXTENSIONS.includes(ext)) return ext;
  return '';
}

const requiredEnvVars = ['DO_SPACES_KEY', 'DO_SPACES_SECRET', 'DO_SPACES_BUCKET', 'DO_SPACES_REGION', 'DO_SPACES_ENDPOINT'];
const missingVars = requiredEnvVars.filter((key) => !process.env[key]);

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function trimSurroundingSlashes(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

function buildDefaultCdnEndpoint() {
  const bucket = process.env.DO_SPACES_BUCKET;
  const region = process.env.DO_SPACES_REGION;
  return `https://${bucket}.${region}.cdn.digitaloceanspaces.com`;
}

const spacesConfigError = missingVars.length > 0
  ? new Error(`Missing required DigitalOcean Spaces env vars: ${missingVars.join(', ')}`)
  : null;

const spacesClient = spacesConfigError
  ? null
  : new S3Client({
    region: process.env.DO_SPACES_REGION,
    endpoint: process.env.DO_SPACES_ENDPOINT,
    forcePathStyle: false,
    credentials: {
      accessKeyId: process.env.DO_SPACES_KEY,
      secretAccessKey: process.env.DO_SPACES_SECRET
    }
  });

const spacesBucket = process.env.DO_SPACES_BUCKET;
const cdnBaseUrl = trimTrailingSlash(process.env.DO_SPACES_CDN_ENDPOINT || buildDefaultCdnEndpoint());
const spacesProjectPrefix = trimSurroundingSlashes(process.env.DO_SPACES_PROJECT_PREFIX || 'petrozen');

function ensureSpacesReady() {
  if (spacesConfigError) {
    throw spacesConfigError;
  }
}

function buildObjectKey(subdir, originalname) {
  const ext = safeExt(originalname);
  const uniqueId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const moduleDir = trimSurroundingSlashes(subdir);
  const fileName = `${Date.now()}-${uniqueId}${ext}`;
  if (spacesProjectPrefix) {
    return `${spacesProjectPrefix}/${moduleDir}/${fileName}`;
  }
  return `${moduleDir}/${fileName}`;
}

function buildPublicUrl(objectKey) {
  return `${cdnBaseUrl}/${objectKey}`;
}

class SpacesStorageEngine {
  constructor(subdir) {
    this.subdir = subdir;
  }

  _handleFile(req, file, cb) {
    let objectKey;
    try {
      ensureSpacesReady();
      objectKey = buildObjectKey(this.subdir, file.originalname);
    } catch (err) {
      cb(err);
      return;
    }

    const uploader = new Upload({
      client: spacesClient,
      params: {
        Bucket: spacesBucket,
        Key: objectKey,
        Body: file.stream,
        ACL: 'public-read',
        ContentType: file.mimetype || 'application/octet-stream'
      }
    });

    uploader.done()
      .then(() => {
        cb(null, {
          key: objectKey,
          filename: objectKey.split('/').pop(),
          bucket: spacesBucket,
          location: buildPublicUrl(objectKey),
          cdnUrl: buildPublicUrl(objectKey)
        });
      })
      .catch((err) => {
        cb(err);
      });
  }

  _removeFile(req, file, cb) {
    if (!file || !file.key) {
      cb(null);
      return;
    }

    spacesClient.send(new DeleteObjectCommand({
      Bucket: spacesBucket,
      Key: file.key
    }))
      .then(() => cb(null))
      .catch((err) => cb(err));
  }
}

function uploadFor(subdir) {
  return multer({
    storage: new SpacesStorageEngine(subdir),
    fileFilter: (req, file, cb) => {
      if (file && typeof file.mimetype === 'string' && file.mimetype.startsWith('image/')) {
        cb(null, true);
        return;
      }
      cb(new Error('Only image uploads are allowed'));
    },
    limits: { fileSize: 5 * 1024 * 1024 }
  });
}

function uploadSingleFor(subdir, fieldName = 'image') {
  const middleware = uploadFor(subdir).single(fieldName);
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) {
        next();
        return;
      }

      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(400).json({ message: 'File too large. Maximum size is 5MB.' });
          return;
        }
        res.status(400).json({ message: `Upload error: ${err.message}` });
        return;
      }

      const providerErrorNames = new Set([
        'InvalidAccessKeyId',
        'SignatureDoesNotMatch',
        'AccessDenied',
        'NoSuchBucket',
        'CredentialsProviderError'
      ]);

      const isProviderError = Boolean(
        (err && err.$metadata) ||
        (err && err.Code) ||
        (err && providerErrorNames.has(err.name)) ||
        (err && typeof err.message === 'string' && /(access key|signature|bucket|credentials|digitalocean|spaces)/i.test(err.message))
      );

      if (isProviderError) {
        console.error('Spaces upload error:', err);
        res.status(500).json({ message: 'Storage upload failed. Check DigitalOcean Spaces credentials and bucket settings.' });
        return;
      }

      if (err && typeof err.message === 'string') {
        const isConfigIssue = err.message.startsWith('Missing required DigitalOcean Spaces env vars');
        res.status(isConfigIssue ? 500 : 400).json({ message: err.message });
        return;
      }

      res.status(500).json({ message: 'Failed to upload file' });
    });
  };
}

function uploadedFileUrl(file) {
  if (!file) return '';
  return file.cdnUrl || file.location || '';
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
  // legacy local path support
  if (imageUrl.startsWith('/uploads/')) {
    const relPath = imageUrl.replace(/^\/uploads\/?/, '');
    if (!relPath || relPath.includes('..') || relPath.includes('\\')) return null;
    return relPath;
  }

  // current Spaces CDN URL
  if (cdnBaseUrl && imageUrl.startsWith(`${cdnBaseUrl}/`)) {
    return imageUrl.replace(`${cdnBaseUrl}/`, '');
  }

  // fallback: parse as URL and remove leading slash from pathname
  try {
    const parsed = new URL(imageUrl);
    const normalizedPath = decodeURIComponent(parsed.pathname || '').replace(/^\/+/, '');
    if (!normalizedPath || normalizedPath.includes('..') || normalizedPath.includes('\\')) return null;
    return normalizedPath;
  } catch (_) {
    return null;
  }
}

function tryDeleteFile(objectKey) {
  if (!objectKey || !spacesClient || !spacesBucket) return;
  spacesClient.send(new DeleteObjectCommand({
    Bucket: spacesBucket,
    Key: objectKey
  })).catch(() => {});
}

module.exports = {
  parseBool,
  filePathFromPublicUrl,
  uploadedFileUrl,
  tryDeleteFile,
  upload,
  uploadFor,
  uploadSingleFor,
  SUBDIRS
};
