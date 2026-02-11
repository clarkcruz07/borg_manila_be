const express = require("express");
const Employee = require("../models/Employee");
const Department = require("../models/Department");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

// Helper middleware: only allow HR (2) or Manager (1) to access approval routes
function ensureCanApprove(req, res, next) {
  const role = req.user?.role;
  if (role !== 1 && role !== 2) {
    return res.status(403).json({ error: "Access denied: insufficient role for approvals" });
  }
  next();
}

// Get all departments (now protected; requires valid JWT)
router.get("/departments", verifyToken, async (req, res) => {
  try {
    const departments = await Department.find().sort({ name: 1 });
    res.json(departments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new department (protected; requires valid JWT)
router.post("/departments", verifyToken, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Department name is required" });
    }

    // Check if department already exists
    const existingDept = await Department.findOne({ name });
    if (existingDept) {
      return res.status(400).json({ error: "Department already exists" });
    }

    const department = new Department({
      name,
      description: description || "",
    });

    await department.save();
    res.status(201).json({
      message: "Department created successfully",
      department,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or update employee profile (requires authentication)
router.post("/profile", verifyToken, async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      birthDate,
      personalEmail,
      mobileNumber,
      homeAddress,
      emergencyContactName,
      relationship,
      emergencyContactNumber,
      position,
      company,
      department,
      dateHired,
      profilePicture,
      sssNumber,
      philhealthNumber,
      tinNumber,
      pagibigNumber,
    } = req.body;

    // Validate required fields
    if (
      !firstName ||
      !lastName ||
      !birthDate ||
      !personalEmail ||
      !mobileNumber ||
      !homeAddress ||
      !emergencyContactName ||
      !relationship ||
      !emergencyContactNumber ||
      !position ||
      !company ||
      !department
    ) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Check if employee profile already exists
    let employee = await Employee.findOne({ userId: req.user.userId });

    if (employee) {
      // Update existing profile
      employee.firstName = firstName;
      employee.lastName = lastName;
      employee.birthDate = birthDate;
      employee.personalEmail = personalEmail;
      employee.mobileNumber = mobileNumber;
      employee.homeAddress = homeAddress;
      employee.emergencyContactName = emergencyContactName;
      employee.relationship = relationship;
      employee.emergencyContactNumber = emergencyContactNumber;
      employee.position = position;
      employee.company = company;
      employee.department = department;
      employee.dateHired = dateHired || employee.dateHired;
      if (profilePicture) employee.profilePicture = profilePicture;
      employee.sssNumber = sssNumber || "";
      employee.philhealthNumber = philhealthNumber || "";
      employee.tinNumber = tinNumber || "";
      employee.pagibigNumber = pagibigNumber || "";

      // If manager (role = 1) is updating their own profile, keep it approved.
      // Otherwise, reset approval status to pending so a manager can approve.
      if (req.user.role === 1) {
        employee.approval_status = 1;
      } else {
        employee.approval_status = 0;
      }
      
      // Clear rejection reason when resubmitting
      employee.rejectionReason = undefined;

      employee.updatedAt = Date.now();
    } else {
      // Create new profile
      employee = new Employee({
        userId: req.user.userId,
        firstName,
        lastName,
        birthDate,
        personalEmail,
        mobileNumber,
        homeAddress,
        emergencyContactName,
        relationship,
        emergencyContactNumber,
        position,
        company,
        department,
        dateHired,
        profilePicture,
        sssNumber: sssNumber || "",
        philhealthNumber: philhealthNumber || "",
        tinNumber: tinNumber || "",
        pagibigNumber: pagibigNumber || "",
        // Manager (role = 1) auto-approved, others start as pending
        approval_status: req.user.role === 1 ? 1 : 0,
      });
    }

    await employee.save();
    res.json({
      message: "Employee profile saved successfully",
      approval_status: employee.approval_status,
      employee,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get employee profile (requires authentication)
router.get("/profile", verifyToken, async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.userId });

    if (!employee) {
      return res.status(404).json({ error: "Employee profile not found" });
    }

    res.json(employee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get employee by userId (for viewing a specific employee profile)
router.get("/profile/:userId", verifyToken, async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.params.userId });

    if (!employee) {
      return res.status(404).json({ error: "Employee profile not found" });
    }

    res.json(employee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update approval status
// - HR (role 2) can approve Employees (role 3)
// - Manager (role 1) can approve HR (role 2)
router.patch("/profile/:employeeId/approve", verifyToken, ensureCanApprove, async (req, res) => {
  try {
    const { approval_status } = req.body;

    if (approval_status === undefined || ![-1, 0, 1].includes(approval_status)) {
      return res.status(400).json({ error: "Invalid approval status" });
    }

    const approverRole = req.user.role; // 1 = Manager, 2 = HR
    const approverUserId = req.user.userId;

    // Load employee with associated user role
    const employee = await Employee.findById(req.params.employeeId).populate(
      "userId",
      "role email"
    );

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    // Do not allow users to approve their own profile
    if (employee.userId && String(employee.userId._id) === String(approverUserId)) {
      return res.status(403).json({ error: "You cannot approve your own profile" });
    }

    // Determine which user roles this approver is allowed to approve
    // - HR (2) can approve Employees (3)
    // - Manager (1) can approve both HR (2) and Employees (3)
    const allowedTargetRoles =
      approverRole === 2 ? [3] : [2, 3];

    if (!employee.userId || !allowedTargetRoles.includes(employee.userId.role)) {
      return res.status(403).json({ error: "You are not allowed to approve this profile" });
    }

    employee.approval_status = approval_status;
    
    // Clear rejection reason if approving
    if (approval_status === 1) {
      employee.rejectionReason = undefined;
    }
    
    employee.updatedAt = Date.now();
    await employee.save();

    res.json({
      message: "Approval status updated",
      employee,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reject employee profile with reason
router.patch("/profile/:employeeId/reject", verifyToken, ensureCanApprove, async (req, res) => {
  try {
    const { rejectionReason } = req.body;

    if (!rejectionReason || rejectionReason.trim() === "") {
      return res.status(400).json({ error: "Rejection reason is required" });
    }

    const approverRole = req.user.role;
    const approverUserId = req.user.userId;

    const employee = await Employee.findById(req.params.employeeId).populate(
      "userId",
      "role email"
    );

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    // Do not allow users to reject their own profile
    if (employee.userId && String(employee.userId._id) === String(approverUserId)) {
      return res.status(403).json({ error: "You cannot reject your own profile" });
    }

    // Check permissions
    const allowedTargetRoles = approverRole === 2 ? [3] : [2, 3];

    if (!employee.userId || !allowedTargetRoles.includes(employee.userId.role)) {
      return res.status(403).json({ error: "You are not allowed to reject this profile" });
    }

    employee.approval_status = -1;
    employee.rejectionReason = rejectionReason;
    employee.updatedAt = Date.now();
    await employee.save();

    res.json({
      message: "Profile rejected successfully",
      employee,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all employees (admin only - for HR to view pending approvals)
router.get("/", verifyToken, async (req, res) => {
  try {
    const { approval_status } = req.query;
    let query = {};

    if (approval_status !== undefined) {
      query.approval_status = parseInt(approval_status);
    }

    const employees = await Employee.find(query).populate("userId", "email");
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update profile picture only (doesn't affect approval status)
router.patch("/profile/picture", verifyToken, async (req, res) => {
  try {
    const { profilePicture } = req.body;

    if (!profilePicture) {
      return res.status(400).json({ error: "Profile picture is required" });
    }

    const employee = await Employee.findOne({ userId: req.user.userId });

    if (!employee) {
      return res.status(404).json({ error: "Employee profile not found" });
    }

    // Update only the profile picture, don't change approval status
    employee.profilePicture = profilePicture;
    employee.updatedAt = Date.now();

    await employee.save();
    res.json({
      message: "Profile picture updated successfully",
      employee,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get pending employees with full details
// - HR (role 2) sees pending Employees (role 3)
// - Manager (role 1) sees pending HR profiles (role 2)
router.get("/pending-approvals", verifyToken, ensureCanApprove, async (req, res) => {
  try {
    const role = req.user.role;
    const currentUserId = req.user.userId;

    // HR sees Employees; Manager sees both HR and Employees
    const targetUserRoles = role === 2 ? [3] : [2, 3];

    const pending = await Employee.find({ approval_status: 0 }).populate({
      path: "userId",
      select: "email role",
      match: { role: { $in: targetUserRoles } },
    });

    // Filter out any without a matching populated userId (in case of mismatch)
    // and also exclude the currently logged-in user (they shouldn't approve themselves)
    const filtered = pending.filter(
      (emp) => emp.userId && String(emp.userId._id) !== String(currentUserId)
    );

    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
