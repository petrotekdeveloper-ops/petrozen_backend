const mongoose = require('mongoose');

const ChatbotServiceQuestionSchema = new mongoose.Schema(
  {
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

ChatbotServiceQuestionSchema.index({ sortOrder: 1 });

module.exports = mongoose.model('ChatbotServiceQuestion', ChatbotServiceQuestionSchema);
