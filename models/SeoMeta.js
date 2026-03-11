const mongoose = require('mongoose');

const SeoMetaSchema = new mongoose.Schema(
  {
    pageType: {
      type: String,
      required: true,
      enum: ['static', 'category', 'subcategory', 'product'],
      index: true
    },
    pageKey: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    metaTitle: { type: String, default: '', trim: true },
    metaDescription: { type: String, default: '', trim: true },
    metaKeywords: { type: String, default: '', trim: true }
  },
  { timestamps: true }
);

SeoMetaSchema.index({ pageType: 1, pageKey: 1 }, { unique: true });

module.exports = mongoose.model('SeoMeta', SeoMetaSchema);
