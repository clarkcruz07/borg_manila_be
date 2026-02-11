const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Employee = require('../models/Employee');
const { verifyToken } = require('../middleware/auth');
const multer = require('multer');
const { cloudinary, USE_CLOUDINARY } = require('../config/cloudinary');

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Office location configuration
const OFFICE_LOCATION = {
  latitude: 14.5829394,
  longitude: 121.0554831,
  radius: 100 // meters
};

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Upload image to Cloudinary with folder structure: {last_name, first_name}/{date}
async function uploadBiometricImage(fileBuffer, lastName, firstName) {
  const today = new Date();
  const dateFolder = today.toISOString().split('T')[0]; // YYYY-MM-DD format
  const folderPath = `biometrics/${lastName}_${firstName}/${dateFolder}`;
  
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folderPath,
        resource_type: 'image',
        format: 'jpg',
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    
    uploadStream.end(fileBuffer);
  });
}

// Clock In
router.post('/clock-in', verifyToken, upload.single('biometricImage'), async (req, res) => {
  try {
    const { latitude, longitude, accuracy, workMode, biometricVerified } = req.body;
    
    // Validate work mode
    if (!workMode || !['Office', 'WFH'].includes(workMode)) {
      return res.status(400).json({ error: 'Valid work mode required (Office or WFH)' });
    }

    // Get employee profile
    const employee = await Employee.findOne({ userId: req.user.userId });
    if (!employee) {
      return res.status(404).json({ error: 'Employee profile not found' });
    }

    let distance = null;
    let biometricImageUrl = null;

    // For Office mode: validate location
    if (workMode === 'Office') {
      if (!latitude || !longitude) {
        return res.status(400).json({ error: 'Location coordinates required for Office mode' });
      }

      // Calculate distance from office
      distance = calculateDistance(
        parseFloat(latitude),
        parseFloat(longitude),
        OFFICE_LOCATION.latitude,
        OFFICE_LOCATION.longitude
      );

      // Verify within range
      if (distance > OFFICE_LOCATION.radius) {
        return res.status(403).json({ 
          error: 'Location out of range. Please be at the office to clock in as Office mode.',
          distance: Math.round(distance),
          required: OFFICE_LOCATION.radius
        });
      }
    }

    // Upload biometric image to Cloudinary if provided
    if (req.file && USE_CLOUDINARY) {
      try {
        biometricImageUrl = await uploadBiometricImage(
          req.file.buffer,
          employee.lastName,
          employee.firstName
        );
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        // Continue without image if upload fails
      }
    }

    // Check if already clocked in today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const lastClockIn = await Attendance.findOne({
      userId: req.user.userId,
      action: 'clock-in',
      timestamp: { $gte: today }
    }).sort({ timestamp: -1 });

    if (lastClockIn) {
      // Check if there's a clock-out after this clock-in
      const lastClockOut = await Attendance.findOne({
        userId: req.user.userId,
        action: 'clock-out',
        timestamp: { $gte: lastClockIn.timestamp }
      });

      if (!lastClockOut) {
        return res.status(400).json({ 
          error: 'Already clocked in',
          lastClockIn: lastClockIn.timestamp
        });
      }
    }

    // Create attendance record
    const attendanceData = {
      userId: req.user.userId,
      employeeId: employee._id,
      action: 'clock-in',
      timestamp: new Date(),
      workMode,
      biometricVerified: false,
      biometricImageUrl,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    };

    // Add location data if provided (Office mode or optional for WFH)
    if (latitude && longitude) {
      attendanceData.location = {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        accuracy: parseFloat(accuracy) || null
      };
      attendanceData.distance = distance ? Math.round(distance) : null;
    }

    const attendance = new Attendance(attendanceData);
    await attendance.save();

    res.json({
      success: true,
      message: `Clocked in successfully (${workMode})`,
      timestamp: attendance.timestamp,
      workMode: attendance.workMode,
      distance: distance ? Math.round(distance) : null
    });
  } catch (err) {
    console.error('Clock-in error:', err);
    res.status(500).json({ error: 'Failed to clock in' });
  }
});

// Clock Out
router.post('/clock-out', verifyToken, upload.single('biometricImage'), async (req, res) => {
  try {
    const { latitude, longitude, accuracy, workMode, biometricVerified } = req.body;

    // Get employee profile
    const employee = await Employee.findOne({ userId: req.user.userId });
    if (!employee) {
      return res.status(404).json({ error: 'Employee profile not found' });
    }

    let distance = null;
    let biometricImageUrl = null;

    // For Office mode: validate location
    if (workMode === 'Office') {
      if (!latitude || !longitude) {
        return res.status(400).json({ error: 'Location coordinates required for Office mode' });
      }

      // Calculate distance from office
      distance = calculateDistance(
        parseFloat(latitude),
        parseFloat(longitude),
        OFFICE_LOCATION.latitude,
        OFFICE_LOCATION.longitude
      );

      // Verify within range
      if (distance > OFFICE_LOCATION.radius) {
        return res.status(403).json({ 
          error: 'Location out of range. Please be at the office to clock out as Office mode.',
          distance: Math.round(distance),
          required: OFFICE_LOCATION.radius
        });
      }
    }

    // Upload biometric image to Cloudinary if provided
    if (req.file && USE_CLOUDINARY) {
      try {
        biometricImageUrl = await uploadBiometricImage(
          req.file.buffer,
          employee.lastName,
          employee.firstName
        );
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
      }
    }

    // Check if clocked in (find last clock-in without clock-out)
    const lastClockIn = await Attendance.findOne({
      userId: req.user.userId,
      action: 'clock-in'
    }).sort({ timestamp: -1 });

    if (!lastClockIn) {
      return res.status(400).json({ error: 'Not clocked in' });
    }

    // Check if already clocked out after last clock-in
    const lastClockOut = await Attendance.findOne({
      userId: req.user.userId,
      action: 'clock-out',
      timestamp: { $gte: lastClockIn.timestamp }
    });

    if (lastClockOut) {
      return res.status(400).json({ 
        error: 'Already clocked out',
        lastClockOut: lastClockOut.timestamp
      });
    }

    // Create attendance record
    const attendanceData = {
      userId: req.user.userId,
      employeeId: employee._id,
      action: 'clock-out',
      timestamp: new Date(),
      workMode: workMode || lastClockIn.workMode, // Use same mode as clock-in if not provided
      biometricVerified: false,
      biometricImageUrl,
      ipAddress: req.ip,
      deviceInfo: req.headers['user-agent']
    };

    // Add location data if provided
    if (latitude && longitude) {
      attendanceData.location = {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        accuracy: parseFloat(accuracy) || null
      };
      attendanceData.distance = distance ? Math.round(distance) : null;
    }

    const attendance = new Attendance(attendanceData);
    await attendance.save();

    // Calculate work duration
    const duration = Math.floor((attendance.timestamp - lastClockIn.timestamp) / 60000); // minutes

    res.json({
      success: true,
      message: `Clocked out successfully (${attendanceData.workMode})`,
      timestamp: attendance.timestamp,
      workMode: attendanceData.workMode,
      distance: distance ? Math.round(distance) : null,
      duration: duration
    });
  } catch (err) {
    console.error('Clock-out error:', err);
    res.status(500).json({ error: 'Failed to clock out' });
  }
});

// Get current status (clocked in or out)
router.get('/status', verifyToken, async (req, res) => {
  try {
    // Find last clock-in
    const lastClockIn = await Attendance.findOne({
      userId: req.user.userId,
      action: 'clock-in'
    }).sort({ timestamp: -1 });

    if (!lastClockIn) {
      return res.json({ clockedIn: false });
    }

    // Check if clocked out after last clock-in
    const lastClockOut = await Attendance.findOne({
      userId: req.user.userId,
      action: 'clock-out',
      timestamp: { $gte: lastClockIn.timestamp }
    });

    if (lastClockOut) {
      return res.json({ 
        clockedIn: false,
        lastClockIn: lastClockIn.timestamp,
        lastClockOut: lastClockOut.timestamp
      });
    }

    res.json({ 
      clockedIn: true,
      lastClockIn: lastClockIn.timestamp
    });
  } catch (err) {
    console.error('Status check error:', err);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// Get attendance history (for current user)
router.get('/history', verifyToken, async (req, res) => {
  try {
    const { startDate, endDate, limit = 50 } = req.query;
    
    const query = { userId: req.user.userId };
    
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const attendance = await Attendance.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .lean();

    res.json(attendance);
  } catch (err) {
    console.error('History fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Get all attendance records (for managers/HR - role 1 or 2)
router.get('/monitor', verifyToken, async (req, res) => {
  try {
    // Check if user is manager or HR
    if (req.user.role !== 1 && req.user.role !== 2) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { startDate, endDate, userId, limit = 100 } = req.query;
    
    const query = {};
    
    if (userId) {
      query.userId = userId;
    }
    
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = new Date(startDate);
      if (endDate) query.timestamp.$lte = new Date(endDate);
    }

    const attendance = await Attendance.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .populate('employeeId', 'firstName lastName employeeId')
      .lean();

    res.json(attendance);
  } catch (err) {
    console.error('Monitor fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch attendance records' });
  }
});

// Get today's attendance summary (for managers/HR)
router.get('/today-summary', verifyToken, async (req, res) => {
  try {
    // Check if user is manager or HR
    if (req.user.role !== 1 && req.user.role !== 2) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const clockIns = await Attendance.find({
      action: 'clock-in',
      timestamp: { $gte: today }
    }).populate('employeeId', 'firstName lastName employeeId').lean();

    const clockOuts = await Attendance.find({
      action: 'clock-out',
      timestamp: { $gte: today }
    }).populate('employeeId', 'firstName lastName employeeId').lean();

    // Get all employees
    const allEmployees = await Employee.find().lean();

    // Get unique employees who clocked in today
    const uniqueClockedInUserIds = [...new Set(clockIns.map(ci => ci.userId.toString()))];
    
    // Get unique employees who clocked out today
    const uniqueClockedOutUserIds = [...new Set(clockOuts.map(co => co.userId.toString()))];

    // Group records by employee - show one session per employee
    const employeeSessions = {};
    
    clockIns.forEach(ci => {
      const userId = ci.userId.toString();
      if (!employeeSessions[userId]) {
        employeeSessions[userId] = {
          employee: ci.employeeId,
          firstClockIn: ci.timestamp,
          lastClockOut: null,
          location: ci.location
        };
      } else {
        // Update to earliest clock-in
        if (ci.timestamp < employeeSessions[userId].firstClockIn) {
          employeeSessions[userId].firstClockIn = ci.timestamp;
          employeeSessions[userId].location = ci.location;
        }
      }
    });

    clockOuts.forEach(co => {
      const userId = co.userId.toString();
      if (employeeSessions[userId]) {
        // Update to latest clock-out
        if (!employeeSessions[userId].lastClockOut || co.timestamp > employeeSessions[userId].lastClockOut) {
          employeeSessions[userId].lastClockOut = co.timestamp;
        }
      }
    });

    // Convert to array and calculate duration
    const records = Object.values(employeeSessions).map(session => ({
      employee: session.employee,
      clockIn: session.firstClockIn,
      clockOut: session.lastClockOut,
      duration: session.lastClockOut ? 
        Math.floor((session.lastClockOut - session.firstClockIn) / 60000) : null,
      location: session.location
    }));

    // Build summary
    const summary = {
      totalEmployees: allEmployees.length,
      clockedIn: uniqueClockedInUserIds.length,
      clockedOut: uniqueClockedOutUserIds.length,
      notClockedIn: allEmployees.length - uniqueClockedInUserIds.length,
      records: records
    };

    res.json(summary);
  } catch (err) {
    console.error('Summary fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

module.exports = router;
