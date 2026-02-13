const mongoose = require("mongoose");
const crypto = require("crypto");

const receiptSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    filePath: {
      type: String,
      required: true,
    },
    originalName: {
      type: String,
      default: null,
    },
    extracted: {
      shopName: { type: String, default: null },
      tinNumber: { type: String, default: null },
      amountDue: { type: String, default: null },
      address: { type: String, default: null },
      date: { type: String, default: null }, // e.g. "September 15, 2025"
    },
    // Normalized key for grouping by month-year (YYYY-MM). Falls back to createdAt month-year.
    monthYearKey: {
      type: String,
      default: null,
      index: true,
    },
    // SHA-256 hash of the uploaded file for exact duplicate detection
    fileHash: {
      type: String,
      default: undefined,
      index: true,
    },
    // Fingerprint based on extracted receipt data (TIN + date + amount + shop) for same-receipt detection
    receiptKey: {
      type: String,
      default: undefined,
      index: true,
    },
  },
  { timestamps: true }
);

// Compound indexes to prevent duplicates per user.
// Partial filters avoid false duplicate conflicts when key/hash is missing.
receiptSchema.index(
  { userId: 1, receiptKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      receiptKey: { $exists: true, $type: "string" },
    },
  }
);
receiptSchema.index(
  { userId: 1, fileHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      fileHash: { $exists: true, $type: "string" },
    },
  }
);

module.exports = mongoose.model("Receipt", receiptSchema);

