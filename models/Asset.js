const mongoose = require("mongoose");

const assetSchema = new mongoose.Schema(
  {
    assetTag: {
      type: String,
      required: true,
      unique: true,
    },
    assetType: {
      type: String,
      required: true,
      enum: ["Laptop", "Desktop", "Monitor", "Phone", "Tablet", "Keyboard", "Mouse", "Headset", "Webcam", "Docking Station", "Other"],
    },
    brand: {
      type: String,
      required: false,
    },
    model: {
      type: String,
      required: false,
    },
    serialNumber: {
      type: String,
      required: false,
    },
    specifications: {
      type: String,
      required: false,
    },
    purchaseDate: {
      type: Date,
      required: false,
    },
    purchaseCost: {
      type: Number,
      required: false,
    },
    warrantyExpiry: {
      type: Date,
      required: false,
    },
    status: {
      type: String,
      required: true,
      enum: ["Available", "Assigned", "Maintenance", "Retired", "Lost/Stolen"],
      default: "Available",
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "employee_details",
      required: false,
    },
    assignedDate: {
      type: Date,
      required: false,
    },
    location: {
      type: String,
      required: false,
    },
    notes: {
      type: String,
      required: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Asset", assetSchema);
