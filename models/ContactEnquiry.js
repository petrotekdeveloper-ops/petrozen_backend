const mongoose = require('mongoose');

const ContactEnquirySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    company: {
      type: String,
      default: '',
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

ContactEnquirySchema.index({ createdAt: -1 });

module.exports = mongoose.model('ContactEnquiry', ContactEnquirySchema);
