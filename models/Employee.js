const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      required: true,
    },
    birthDate: {
      type: Date,
      required: true,
    },
    personalEmail: {
      type: String,
      required: true,
    },
    mobileNumber: {
      type: String,
      required: true,
    },
    homeAddress: {
      type: String,
      required: true,
    },
    emergencyContactName: {
      type: String,
      required: true,
    },
    relationship: {
      type: String,
      required: true,
    },
    emergencyContactNumber: {
      type: String,
      required: true,
    },
    position: {
      type: String,
      required: true,
    },
    company: {
      type: String,
      required: true,
    },
    department: {
      type: String,
      required: true,
    },
    sssNumber: {
      type: String,
      required: false,
    },
    philhealthNumber: {
      type: String,
      required: false,
    },
    tinNumber: {
      type: String,
      required: false,
    },
    pagibigNumber: {
      type: String,
      required: false,
    },
    approval_status: {
      type: Number,
      enum: [0, 1], // 0 = pending, 1 = approved
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("employee_details", employeeSchema);
