const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'employee_details',
    required: true
  },
  action: {
    type: String,
    enum: ['clock-in', 'clock-out'],
    required: true
  },
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  workMode: {
    type: String,
    enum: ['Office', 'WFH'],
    required: true,
    default: 'Office'
  },
  location: {
    latitude: {
      type: Number,
      required: false // Optional for WFH
    },
    longitude: {
      type: Number,
      required: false // Optional for WFH
    },
    accuracy: Number // GPS accuracy in meters
  },
  distance: {
    type: Number, // Distance from office in meters
    required: false // Not required for WFH
  },
  biometricVerified: {
    type: Boolean,
    default: false
  },
  biometricImageUrl: {
    type: String, // Cloudinary URL
    required: false
  },
  duration: {
    type: Number, // Duration in minutes (for clock-out records)
    required: false
  },
  ipAddress: String,
  deviceInfo: String
}, {
  timestamps: true
});

// Index for efficient queries
attendanceSchema.index({ userId: 1, timestamp: -1 });
attendanceSchema.index({ employeeId: 1, timestamp: -1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
