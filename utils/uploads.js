const multer = require('multer');
const crypto = require('crypto');
const sharp = require('sharp');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const SUBDIRS = ['categories', 'subcategories', 'products', 'blog', 'brands'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
const PDF_EXTENSIONS = ['.pdf'];
const ALLOWED_EXTENSIONS = [...IMAGE_EXTENSIONS, ...PDF_EXTENSIONS];

// WebP conversion settings
const WEBP_QUALITY = 80;
const WEBP_MAX_WIDTH = 1600;

// Image MIME types that will be converted to WebP (jpg, jpeg, png)
const CONVERTIBLE_IMAGE_MIMETYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);
const CONVERTIBLE_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);

function safeExt(originalname) {
  const name = String(originalname || '');
  const dotIndex = name.lastIndexOf('.');
  const ext = dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
  if (ALLOWED_EXTENSIONS.includes(ext)) return ext;
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

function buildObjectKey(subdir, originalname, outputExt) {
  const ext = outputExt || safeExt(originalname);
  const uniqueId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const moduleDir = trimSurroundingSlashes(subdir);
  const fileName = `${Date.now()}-${uniqueId}${ext}`;
  if (spacesProjectPrefix) {
    return `${spacesProjectPrefix}/${moduleDir}/${fileName}`;
  }
  return `${moduleDir}/${fileName}`;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function convertToWebP(buffer) {
  return sharp(buffer)
    .resize(WEBP_MAX_WIDTH, null, { withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
}

function shouldConvertToWebP(mimetype, originalname) {
  const ext = safeExt(originalname);
  return (
    CONVERTIBLE_IMAGE_MIMETYPES.has(String(mimetype || '').toLowerCase()) &&
    CONVERTIBLE_IMAGE_EXTENSIONS.has(ext)
  );
}

function buildPublicUrl(objectKey) {
  return `${cdnBaseUrl}/${objectKey}`;
}

class SpacesStorageEngine {
  constructor(subdir, options = {}) {
    this.subdir = subdir;
    this.convertImagesToWebP = options.convertImagesToWebP !== false;
  }

  async _processAndUpload(file, objectKey, body, contentType) {
    const uploader = new Upload({
      client: spacesClient,
      params: {
        Bucket: spacesBucket,
        Key: objectKey,
        Body: body,
        ACL: 'public-read',
        ContentType: contentType
      }
    });
    await uploader.done();
    return {
      key: objectKey,
      filename: objectKey.split('/').pop(),
      bucket: spacesBucket,
      location: buildPublicUrl(objectKey),
      cdnUrl: buildPublicUrl(objectKey)
    };
  }

  _handleFile(req, file, cb) {
    (async () => {
      try {
        ensureSpacesReady();
        const buffer = await streamToBuffer(file.stream);
        const mimetype = String(file.mimetype || '').toLowerCase();
        const willConvert = this.convertImagesToWebP && shouldConvertToWebP(mimetype, file.originalname);

        let body;
        let objectKey;
        let contentType;

        if (willConvert) {
          body = await convertToWebP(buffer);
          objectKey = buildObjectKey(this.subdir, file.originalname, '.webp');
          contentType = 'image/webp';
        } else {
          body = buffer;
          objectKey = buildObjectKey(this.subdir, file.originalname);
          contentType = mimetype || 'application/octet-stream';
        }

        const result = await this._processAndUpload(file, objectKey, body, contentType);
        cb(null, result);
      } catch (err) {
        cb(err);
      }
    })();
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

function isAllowedImageMimetype(mimetype) {
  return CONVERTIBLE_IMAGE_MIMETYPES.has(String(mimetype || '').toLowerCase());
}

function uploadFor(subdir) {
  return multer({
    storage: new SpacesStorageEngine(subdir),
    fileFilter: (req, file, cb) => {
      if (!file || typeof file.mimetype !== 'string') {
        cb(new Error('Invalid file'));
        return;
      }
      if (isAllowedImageMimetype(file.mimetype) && CONVERTIBLE_IMAGE_EXTENSIONS.has(safeExt(file.originalname))) {
        cb(null, true);
        return;
      }
      cb(new Error('Only JPEG and PNG images are allowed'));
    },
    limits: { fileSize: 5 * 1024 * 1024 }
  });
}

function handleMulterUploadError(err, res) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ message: 'File too large. Maximum size is 5MB.' });
      return true;
    }
    res.status(400).json({ message: `Upload error: ${err.message}` });
    return true;
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
    return true;
  }

  if (err && typeof err.message === 'string') {
    const isConfigIssue = err.message.startsWith('Missing required DigitalOcean Spaces env vars');
    res.status(isConfigIssue ? 500 : 400).json({ message: err.message });
    return true;
  }

  res.status(500).json({ message: 'Failed to upload file' });
  return true;
}

function uploadSingleFor(subdir, fieldName = 'image') {
  const middleware = uploadFor(subdir).single(fieldName);
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) {
        next();
        return;
      }
      handleMulterUploadError(err, res);
    });
  };
}

function uploadArrayFor(subdir, fieldName = 'images', maxCount = 15) {
  const middleware = uploadFor(subdir).array(fieldName, maxCount);
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) {
        next();
        return;
      }
      handleMulterUploadError(err, res);
    });
  };
}

function uploadFieldsFor(subdir, fieldRules = []) {
  const rulesByField = new Map(
    (Array.isArray(fieldRules) ? fieldRules : []).map((rule) => [
      String(rule && rule.name ? rule.name : ''),
      {
        allowImages: rule.allowImages !== false,
        allowPdf: Boolean(rule.allowPdf)
      }
    ]).filter(([name]) => Boolean(name))
  );

  const middleware = multer({
    storage: new SpacesStorageEngine(subdir),
    fileFilter: (req, file, cb) => {
      const rule = rulesByField.get(file.fieldname);
      if (!rule) {
        cb(new Error(`Unexpected upload field: ${file.fieldname}`));
        return;
      }

      const mimetype = String(file.mimetype || '').toLowerCase();
      const ext = safeExt(file.originalname);
      const isConvertibleImage = isAllowedImageMimetype(mimetype) && CONVERTIBLE_IMAGE_EXTENSIONS.has(ext);
      const isPdf = mimetype === 'application/pdf' && PDF_EXTENSIONS.includes(ext);

      if ((rule.allowImages && isConvertibleImage) || (rule.allowPdf && isPdf)) {
        cb(null, true);
        return;
      }

      cb(new Error(`Invalid file type for ${file.fieldname}. Allowed: ${rule.allowPdf ? 'JPEG, PNG or PDF' : 'JPEG, PNG images only'}`));
    },
    limits: { fileSize: 5 * 1024 * 1024 }
  }).fields(fieldRules.map(({ name, maxCount = 1 }) => ({ name, maxCount })));

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
  uploadArrayFor,
  uploadFieldsFor,
  SUBDIRS
};
