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
      required: false,
    },
    dateHired: {
      type: Date,
      required: true,
    },
    profilePicture: {
      type: String,
      required: false,
    },
    sssNumber: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          return /^\d{2}-\d{7}-\d{1}$/.test(v);
        },
        message: 'SSS Number must follow format XX-XXXXXXX-X'
      }
    },
    philhealthNumber: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          return /^\d{2}-\d{9}-\d{1}$/.test(v);
        },
        message: 'PhilHealth Number must follow format XX-XXXXXXXXX-X'
      }
    },
    tinNumber: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          return /^\d{3}-\d{3}-\d{3}-\d{3}$/.test(v);
        },
        message: 'TIN Number must follow format XXX-XXX-XXX-XXX'
      }
    },
    pagibigNumber: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          return /^\d{4}-\d{4}-\d{4}$/.test(v);
        },
        message: 'Pag-IBIG Number must follow format XXXX-XXXX-XXXX'
      }
    },
    // Leave Credits (1 per month from hire date)
    leaveCredits: {
      type: Number,
      default: 0,
    },
    usedLeaveCredits: {
      type: Number,
      default: 0,
    },
    lastLeaveCalculation: {
      type: Date,
      required: false,
    },
    approval_status: {
      type: Number,
      enum: [-1, 0, 1], // -1 = rejected, 0 = pending, 1 = approved
      default: 0,
    },
    rejectionReason: {
      type: String,
      required: false,
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
