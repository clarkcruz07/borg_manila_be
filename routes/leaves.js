const express = require("express");
const Leave = require("../models/Leave");
const Employee = require("../models/Employee");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

// Helper function to calculate leave credits based on hire date
// 1 credit per month of employment (per leave type)
const calculateLeaveCredits = (dateHired) => {
  if (!dateHired) return 0;
  
  const hireDate = new Date(dateHired);
  const currentDate = new Date();
  
  // Calculate the difference in months
  const yearsDiff = currentDate.getFullYear() - hireDate.getFullYear();
  const monthsDiff = currentDate.getMonth() - hireDate.getMonth();
  const totalMonths = yearsDiff * 12 + monthsDiff;
  
  // Return total months (1 credit per month)
  return Math.max(0, totalMonths);
};

// Helper function to calculate number of business days between two dates
const calculateBusinessDays = (startDate, endDate) => {
  let count = 0;
  let currentDate = new Date(startDate);
  const end = new Date(endDate);
  
  while (currentDate <= end) {
    const dayOfWeek = currentDate.getDay();
    // Count only weekdays (Monday = 1, Friday = 5)
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return count;
};

// Get leave balance for current user
router.get("/balance", verifyToken, async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.userId });
    
    if (!employee) {
      return res.status(404).json({ error: "Employee profile not found" });
    }
    
    // Calculate current leave credits based on hire date (per type)
    const totalCreditsPerType = calculateLeaveCredits(employee.dateHired);
    
    // Get used leave credits (approved leaves only), by type
    const approvedLeaves = await Leave.find({
      userId: req.user.userId,
      status: "approved"
    }).lean();
    
    const usedVacationCredits = approvedLeaves.reduce(
      (sum, leave) => sum + (leave.leaveType === "vacation" ? leave.numberOfDays : 0),
      0
    );
    const usedSickCredits = approvedLeaves.reduce(
      (sum, leave) => sum + (leave.leaveType === "sick" ? leave.numberOfDays : 0),
      0
    );
    
    // Update employee's leave credits if needed
    const shouldUpdateCredits =
      employee.vacationCredits !== totalCreditsPerType ||
      employee.sickCredits !== totalCreditsPerType ||
      employee.usedVacationCredits !== usedVacationCredits ||
      employee.usedSickCredits !== usedSickCredits;
    
    if (shouldUpdateCredits) {
      employee.vacationCredits = totalCreditsPerType;
      employee.sickCredits = totalCreditsPerType;
      employee.usedVacationCredits = usedVacationCredits;
      employee.usedSickCredits = usedSickCredits;
      employee.lastLeaveCalculation = new Date();
      await employee.save();
    }
    
    res.json({
      vacation: {
        totalCredits: totalCreditsPerType,
        usedCredits: usedVacationCredits,
        availableCredits: totalCreditsPerType - usedVacationCredits
      },
      sick: {
        totalCredits: totalCreditsPerType,
        usedCredits: usedSickCredits,
        availableCredits: totalCreditsPerType - usedSickCredits
      },
      dateHired: employee.dateHired,
      monthsEmployed: totalCreditsPerType,
      eligibleToUse: totalCreditsPerType >= 6,
      eligibleAfterMonths: 6
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Apply for leave
router.post("/apply", verifyToken, async (req, res) => {
  try {
    const { leaveType, startDate, endDate, reason, attachments } = req.body;
    
    if (!leaveType || !startDate || !endDate || !reason) {
      return res.status(400).json({ error: "All fields are required" });
    }
    
    if (!["vacation", "sick"].includes(leaveType)) {
      return res.status(400).json({ error: "Invalid leave type" });
    }
    
    const employee = await Employee.findOne({ userId: req.user.userId });
    
    if (!employee) {
      return res.status(404).json({ error: "Employee profile not found" });
    }
    
    // Calculate number of days
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (end < start) {
      return res.status(400).json({ error: "End date must be after start date" });
    }
    
    const numberOfDays = calculateBusinessDays(start, end);
    
    // Leave can be filed even if credits are insufficient or before 6th month
    
    // Check for overlapping leaves
    const overlapping = await Leave.findOne({
      userId: req.user.userId,
      status: { $in: ["pending", "approved"] },
      $or: [
        { startDate: { $lte: end }, endDate: { $gte: start } }
      ]
    });
    
    if (overlapping) {
      return res.status(400).json({ error: "You have overlapping leave dates" });
    }
    
    // Determine initial status based on role
    // Role 1 (Manager) - Auto-approved
    // Role 2 (HR) and Role 3 (Employee) - Pending
    const userRole = req.user.role;
    const initialStatus = userRole === 1 ? "approved" : "pending";
    
    // Create leave application
    const leave = new Leave({
      userId: req.user.userId,
      employeeId: employee._id,
      leaveType,
      startDate: start,
      endDate: end,
      numberOfDays,
      reason,
      attachments: attachments || [],
      status: initialStatus
    });
    
    // If auto-approved (Manager), update used credits immediately
    if (initialStatus === "approved") {
      if (leaveType === "vacation") {
        employee.usedVacationCredits = (employee.usedVacationCredits || 0) + numberOfDays;
      } else if (leaveType === "sick") {
        employee.usedSickCredits = (employee.usedSickCredits || 0) + numberOfDays;
      }
      leave.approvedBy = req.user.userId;
      leave.approvedAt = new Date();
      await employee.save();
    }
    
    await leave.save();
    
    res.status(201).json({
      message: initialStatus === "approved" 
        ? "Leave automatically approved" 
        : "Leave application submitted successfully",
      leave
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get my leave applications
router.get("/my-leaves", verifyToken, async (req, res) => {
  try {
    const { status } = req.query;
    let query = { userId: req.user.userId };
    
    if (status) {
      query.status = status;
    }
    
    const leaves = await Leave.find(query)
      .populate("approvedBy", "email")
      .sort({ createdAt: -1 });
    
    res.json(leaves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get pending leave applications (for managers and HR)
router.get("/pending", verifyToken, async (req, res) => {
  try {
    const role = req.user.role;
    
    // Only managers (1) and HR (2) can view pending leaves
    if (role !== 1 && role !== 2) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    // Fetch all pending leaves with user role information
    const pendingLeaves = await Leave.find({ status: "pending" })
      .populate("userId", "email role")
      .populate("employeeId", "firstName lastName position department")
      .sort({ createdAt: -1 });
    
    // Filter based on approver role:
    // - Manager (role 1) can approve: HR (role 2) and Employee (role 3) leaves
    // - HR (role 2) can approve: Employee (role 3) leaves only
    const filteredLeaves = pendingLeaves.filter(leave => {
      if (!leave.userId) return false;
      
      const applicantRole = leave.userId.role;
      
      if (role === 1) {
        // Manager can approve HR and Employee leaves (role 2 and 3)
        return applicantRole === 2 || applicantRole === 3;
      } else if (role === 2) {
        // HR can approve Employee leaves only (role 3)
        return applicantRole === 3;
      }
      
      return false;
    });
    
    res.json(filteredLeaves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approve/Reject leave
router.patch("/:leaveId/status", verifyToken, async (req, res) => {
  try {
    const role = req.user.role;
    
    // Only managers (1) and HR (2) can approve/reject
    if (role !== 1 && role !== 2) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const { status, rejectionReason } = req.body;
    
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    
    if (status === "rejected" && !rejectionReason) {
      return res.status(400).json({ error: "Rejection reason is required" });
    }
    
    const leave = await Leave.findById(req.params.leaveId)
      .populate("employeeId")
      .populate("userId", "role");
    
    if (!leave) {
      return res.status(404).json({ error: "Leave application not found" });
    }
    
    // Cannot approve own leave
    if (String(leave.userId._id) === String(req.user.userId)) {
      return res.status(403).json({ error: "You cannot approve your own leave" });
    }
    
    // Check if approver has permission based on applicant's role
    const applicantRole = leave.userId.role;
    const approverRole = req.user.role;
    
    if (approverRole === 2 && applicantRole !== 3) {
      // HR can only approve Employee (role 3) leaves
      return res.status(403).json({ error: "HR can only approve employee leaves" });
    }
    
    if (approverRole === 1 && applicantRole === 1) {
      // Manager cannot approve another Manager's leave (Manager leaves are auto-approved)
      return res.status(403).json({ error: "Manager leaves are automatically approved" });
    }
    
    if (leave.status !== "pending") {
      return res.status(400).json({ error: "Leave application has already been processed" });
    }
    
    // If approving, update employee's used credits by type
    if (status === "approved") {
      const employee = leave.employeeId;
      if (leave.leaveType === "vacation") {
        employee.usedVacationCredits = (employee.usedVacationCredits || 0) + leave.numberOfDays;
      } else if (leave.leaveType === "sick") {
        employee.usedSickCredits = (employee.usedSickCredits || 0) + leave.numberOfDays;
      }
      await employee.save();
    }
    
    leave.status = status;
    leave.approvedBy = req.user.userId;
    leave.approvedAt = new Date();
    
    if (status === "rejected") {
      leave.rejectionReason = rejectionReason;
    }
    
    await leave.save();
    
    res.json({
      message: `Leave application ${status} successfully`,
      leave
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel leave (by employee, only if pending)
router.patch("/:leaveId/cancel", verifyToken, async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.leaveId);
    
    if (!leave) {
      return res.status(404).json({ error: "Leave application not found" });
    }
    
    // Only the owner can cancel
    if (String(leave.userId) !== String(req.user.userId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    if (leave.status !== "pending") {
      return res.status(400).json({ error: "Only pending leaves can be cancelled" });
    }
    
    leave.status = "cancelled";
    await leave.save();
    
    res.json({
      message: "Leave application cancelled successfully",
      leave
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all leaves (for admin/reports)
router.get("/all", verifyToken, async (req, res) => {
  try {
    const role = req.user.role;
    
    // Only managers (1) and HR (2) can view all leaves
    if (role !== 1 && role !== 2) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const { status, startDate, endDate } = req.query;
    let query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (startDate && endDate) {
      query.startDate = { $gte: new Date(startDate) };
      query.endDate = { $lte: new Date(endDate) };
    }
    
    const leaves = await Leave.find(query)
      .populate("userId", "email")
      .populate("employeeId", "firstName lastName position department")
      .populate("approvedBy", "email")
      .sort({ createdAt: -1 });
    
    res.json(leaves);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
