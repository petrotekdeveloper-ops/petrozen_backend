const mongoose = require('mongoose');

const blogSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  images: {
    type: [String],
    default: []
  }
}, { timestamps: true });

const jsonTransform = (doc, ret) => {
  ret.images = Array.isArray(ret.images) ? ret.images.filter(Boolean) : [];
  return ret;
};

blogSchema.set('toJSON', { transform: jsonTransform });
blogSchema.set('toObject', { transform: jsonTransform });

const Blog = mongoose.model('Blog', blogSchema);

module.exports = Blog;
