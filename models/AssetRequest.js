const mongoose = require("mongoose");

const assetRequestSchema = new mongoose.Schema(
  {
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employee_details",
      required: true,
    },
    assetType: {
      type: String,
      required: true,
      enum: ["Laptop", "Desktop", "Monitor", "Phone", "Tablet", "Keyboard", "Mouse", "Headset", "Webcam", "Docking Station", "Other"],
    },
    specifications: {
      type: String,
      required: false,
    },
    justification: {
      type: String,
      required: true,
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High", "Urgent"],
      default: "Medium",
    },
    status: {
      type: String,
      required: true,
      enum: ["Pending", "Approved", "Rejected", "Deployed"],
      default: "Pending",
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    approvedDate: {
      type: Date,
      required: false,
    },
    rejectionReason: {
      type: String,
      required: false,
    },
    deployedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    deployedDate: {
      type: Date,
      required: false,
    },
    assignedAsset: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Asset",
      required: false,
    },
    itNotes: {
      type: String,
      required: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AssetRequest", assetRequestSchema);
