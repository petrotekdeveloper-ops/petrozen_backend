const mongoose = require('mongoose');

const DEFAULT_VARIETY_KEYWORD = 'grade';

/** Legacy shape stored in DB until migrated by save; cleared on new writes */
const LegacyVarietyEntrySchema = new mongoose.Schema(
  {
    keyword: { type: String, default: DEFAULT_VARIETY_KEYWORD, trim: true },
    grade: { type: String, default: '', trim: true }
  },
  { _id: false }
);

const ProductSchema = new mongoose.Schema(
  {
    subCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SubCategory',
      required: true,
      index: true
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      default: null,
      index: true
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    imageUrl: { type: String, default: '' },
    features: { type: [String], default: [], trim: true },
    specifications: { type: [String], default: [], trim: true },
    applications: { type: [String], default: [], trim: true },
    /** One label for all options below (e.g. grade, material) */
    varietyKeyword: { type: String, default: DEFAULT_VARIETY_KEYWORD, trim: true },
    /** Values under that keyword */
    varietyValues: { type: [String], default: [], trim: true },
    /** @deprecated old string list */
    grades: { type: [String], default: [], trim: true },
    /** @deprecated old { keyword, grade } rows; cleared when product is saved from admin */
    varieties: { type: [LegacyVarietyEntrySchema], default: [] },
    catelog: { type: String, default: ''},
    sort: {type:String, default:''},
    active: { type: Boolean, default: true, index: true },
    chatbotActive: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', ProductSchema);
