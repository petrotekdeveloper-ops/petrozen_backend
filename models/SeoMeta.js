const mongoose = require('mongoose');

const SeoMetaSchema = new mongoose.Schema(
  {
    // Legacy fields kept for backward compatibility
    pageType: {
      type: String,
      enum: ['static', 'category', 'subcategory', 'product'],
      index: true
    },
    pageKey: {
      type: String,
      trim: true,
      index: true
    },
    // Canonical identity fields
    targetType: {
      type: String,
      enum: ['static', 'category', 'subcategory', 'product'],
      index: true
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true
    },
    staticKey: {
      type: String,
      trim: true,
      index: true
    },
    metaTitle: { type: String, default: '', trim: true },
    metaDescription: { type: String, default: '', trim: true },
    metaKeywords: { type: String, default: '', trim: true }
  },
  { timestamps: true }
);

SeoMetaSchema.index(
  { targetType: 1, targetId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { targetType: { $in: ['category', 'subcategory', 'product'] } } }
);
SeoMetaSchema.index(
  { targetType: 1, staticKey: 1 },
  { unique: true, sparse: true, partialFilterExpression: { targetType: 'static' } }
);
SeoMetaSchema.index({ pageType: 1, pageKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('SeoMeta', SeoMetaSchema);
