const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Employee = require("../models/Employee");
const { verifyToken } = require("../middleware/auth");
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";

// Register - Create user with email and temporary password
// Protected: Only Manager (1) and HR (2) can register new users
router.post("/register", verifyToken, async (req, res) => {
  try {
    const { email, password, role } = req.body;

    // Check if the current user has permission to add users
    const userRole = req.user?.role;
    if (userRole !== 1 && userRole !== 2) {
      return res.status(403).json({ error: "Access denied: Only Manager and HR can add users" });
    }

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Validate role
    if (role && ![1, 2, 3].includes(role)) {
      return res.status(400).json({ error: "Invalid role. Must be 1 (Manager), 2 (HR), or 3 (Employee)" });
    }

    // Create new user
    const user = new User({
      email,
      password,
      role: role || 3, // Default to Employee (3) if not specified
      passwordChanged: false,
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign({ userId: user._id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({
      message: "User registered successfully",
      token,
      userId: user._id,
      email: user.email,
      role: user.role,
      passwordChanged: false,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(400).json({ error: error.message });
  }
});

// Login - Authenticate user
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Generate JWT token
    const token = jwt.sign({ userId: user._id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      token,
      userId: user._id,
      email: user.email,
      role: user.role,
      passwordChanged: user.passwordChanged,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(400).json({ error: error.message });
  }
});

// Change password (on first login)
router.post("/change-password", async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    const authHeader = req.headers.authorization;

    if (!userId || !newPassword) {
      return res.status(400).json({ error: "User ID and new password required" });
    }

    if (!authHeader) {
      return res.status(401).json({ error: "No token provided" });
    }

    // Verify token
    const token = authHeader.split("Bearer ")[1];
    try {
      jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Find user and update password
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    user.password = newPassword;
    user.passwordChanged = true;
    user.passwordChangedAt = new Date();
    await user.save();

    res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Password change error:", error);
    res.status(400).json({ error: error.message });
  }
});

// Get all users (for admin/debugging - returns email, role) – protected with JWT
router.get("/users", verifyToken, async (req, res) => {
  try {
    const users = await User.find().select("email role createdAt passwordChanged").exec();
    
    // Populate employee details including profile picture, position, and dateHired
    const usersWithDetails = await Promise.all(
      users.map(async (user) => {
        const employee = await Employee.findOne({ userId: user._id }).select("firstName lastName position dateHired profilePicture");
        return {
          ...user.toObject(),
          firstName: employee?.firstName || null,
          lastName: employee?.lastName || null,
          position: employee?.position || null,
          dateHired: employee?.dateHired || null,
          profilePicture: employee?.profilePicture || null,
        };
      })
    );
    
    res.json({
      total: usersWithDetails.length,
      users: usersWithDetails,
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(400).json({ error: error.message });
  }
});

// Get current user info (protected)
router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split("Bearer ")[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.userId).select("email createdAt passwordChanged").exec();
      
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json(user);
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  } catch (error) {
    console.error("Get user info error:", error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
