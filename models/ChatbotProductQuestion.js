const mongoose = require('mongoose');

const ChatbotProductQuestionSchema = new mongoose.Schema(
  {
    products: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
      default: [],
      index: true
    },
    questionText: {
      type: String,
      required: true,
      trim: true
    },
    sortOrder: {
      type: Number,
      default: 0
    },
    required: {
      type: Boolean,
      default: true
    },
    answerType: {
      type: String,
      enum: ['plain_text', 'option'],
      default: 'plain_text'
    },
    options: {
      type: [String],
      default: [],
      trim: true
    }
  },
  { timestamps: true }
);

ChatbotProductQuestionSchema.index({ products: 1, sortOrder: 1 });

module.exports = mongoose.model('ChatbotProductQuestion', ChatbotProductQuestionSchema);
