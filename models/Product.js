const mongoose = require('mongoose');

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
    grades: { type: [String], default: [], trim: true },
    catelog: { type: String, default: ''},
    sort: {type:String, default:''},
    active: { type: Boolean, default: true, index: true },
    chatbotActive: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', ProductSchema);
