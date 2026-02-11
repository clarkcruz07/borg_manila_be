const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  filePath: {
    type: String,
    required: true
  },
  cloudinaryUrl: {
    type: String,
    default: null
  },
  originalName: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  result: {
    type: Object,
    default: null
  },
  error: {
    type: String,
    default: null
  },
  attempts: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  processedAt: {
    type: Date,
    default: null
  }
});

// Compound index for efficient queries
jobSchema.index({ userId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Job", jobSchema);
