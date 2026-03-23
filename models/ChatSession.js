const mongoose = require('mongoose');

const ChatSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    phone: {
      type: String,
      default: '',
      trim: true
    },
    currentStep: {
      type: String,
      default: 'welcome',
      trim: true
    },
    flowData: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    status: {
      type: String,
      enum: ['initiated', 'in_progress', 'completed'],
      default: 'initiated',
      index: true
    },
    enquiryType: {
      type: String,
      enum: ['product'],
      default: 'product'
    },
    name: {
      type: String,
      default: '',
      trim: true
    },
    email: {
      type: String,
      default: '',
      trim: true,
      lowercase: true
    },
    company: {
      type: String,
      default: '',
      trim: true
    },
    message: {
      type: String,
      default: '',
      trim: true
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
      index: true
    },
    productLink: {
      type: String,
      default: '',
      trim: true
    },
    completedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ChatSession', ChatSessionSchema);
