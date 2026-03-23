const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    imageUrl: { type: String, default: '' },
    sort: {type:String, default:''},
    active: { type: Boolean, default: true, index: true },
    chatbotActive: { type: Boolean, default: true, index: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Category', CategorySchema);
