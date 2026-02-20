const express = require("express");
const Leave = require("../models/Leave");
const Employee = require("../models/Employee");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

// Apply for leave (file a leave application)
router.post("/apply", verifyToken, async (req, res) => {
  try {
    const { leaveType, startDate, endDate, reason, attachments } = req.body;

    const employee = await Employee.findOne({ userId: req.user.userId });
    if (!employee) {
      return res.status(404).json({ error: "Employee profile not found" });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const numberOfDays = calculateBusinessDays(start, end);

    // Calculate months of tenure
    const hireDate = new Date(employee.dateHired);
    const now = new Date();
    const yearsDiff = now.getFullYear() - hireDate.getFullYear();
    const monthsDiff = now.getMonth() - hireDate.getMonth();
    const totalMonths = yearsDiff * 12 + monthsDiff;
    const hasSixMonths = totalMonths >= 6;

    // Role 1 (Manager) - Auto-approved
    // Role 2 (HR) and Role 3 (Employee) - Pending
    const userRole = req.user.role;
    const initialStatus = userRole === 1 ? "approved" : "pending";

    // If less than 6 months, do not deduct credits yet
    let pendingDeduction = false;
    if (!hasSixMonths) {
      pendingDeduction = true;
    }

    const leave = new Leave({
      userId: req.user.userId,
      employeeId: employee._id,
      leaveType,
      startDate: start,
      endDate: end,
      numberOfDays,
      reason,
      attachments: attachments || [],
      status: initialStatus,
      pendingDeduction, // custom field to track if deduction is pending
    });

    // Only deduct credits if 6+ months and auto-approved
    if (initialStatus === "approved" && hasSixMonths) {
      if (leaveType === "vacation") {
        employee.vacationCredits = Math.max(0, (employee.vacationCredits || 0) - numberOfDays);
      } else if (leaveType === "sick") {
        employee.sickCredits = Math.max(0, (employee.sickCredits || 0) - numberOfDays);
      }
      leave.approvedBy = req.user.userId;
      leave.approvedAt = new Date();
      await employee.save();
    }

    await leave.save();

    return res.status(201).json({
      message: initialStatus === "approved"
        ? (hasSixMonths ? "Leave automatically approved" : "Leave approved, deduction pending 6th month")
        : (hasSixMonths ? "Leave application submitted successfully" : "Leave filed, deduction pending 6th month"),
      leave,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});


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

// Recompute leave credits for employees from approved leave records.
// This keeps employee_details leave fields consistent with source-of-truth Leave data.
const syncEmployeeLeaveCredits = async () => {
  const employees = await Employee.find({}).select(
    "_id userId dateHired vacationCredits sickCredits usedVacationCredits usedSickCredits"
  );

  if (!employees.length) return;

  const userIds = employees.map((emp) => emp.userId).filter(Boolean);
  const approvedLeaves = await Leave.find({
    userId: { $in: userIds },
    status: "approved",
  })
    .select("userId leaveType numberOfDays")
    .lean();

  const usedByUserId = new Map();
  approvedLeaves.forEach((leave) => {
    const userKey = String(leave.userId);
    if (!usedByUserId.has(userKey)) {
      usedByUserId.set(userKey, { vacation: 0, sick: 0 });
    }
    const totals = usedByUserId.get(userKey);
    const days = Number(leave.numberOfDays) || 0;
    if (leave.leaveType === "vacation") totals.vacation += days;
    if (leave.leaveType === "sick") totals.sick += days;
  });

  const updates = [];
  const now = new Date();

  employees.forEach((employee) => {
    const userKey = String(employee.userId);
    const used = usedByUserId.get(userKey) || { vacation: 0, sick: 0 };
    const totalCreditsPerType = calculateLeaveCredits(employee.dateHired);

    const shouldUpdate =
      employee.vacationCredits !== totalCreditsPerType ||
      employee.sickCredits !== totalCreditsPerType ||
      employee.usedVacationCredits !== used.vacation ||
      employee.usedSickCredits !== used.sick;

    if (shouldUpdate) {
      updates.push({
        updateOne: {
          filter: { _id: employee._id },
          update: {
            $set: {
              vacationCredits: totalCreditsPerType,
              sickCredits: totalCreditsPerType,
              usedVacationCredits: used.vacation,
              usedSickCredits: used.sick,
              lastLeaveCalculation: now,
            },
          },
        },
      });
    }
  });

  if (updates.length) {
    await Employee.bulkWrite(updates);
  }
};

// Get leave balance for current user
router.get("/balance", verifyToken, async (req, res) => {
  try {
    const { leaveType, startDate, endDate, reason, attachments } = req.body;

    const employee = await Employee.findOne({ userId: req.user.userId });
    if (!employee) {
      return res.status(404).json({ error: "Employee profile not found" });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    const numberOfDays = calculateBusinessDays(start, end);

    // Role 1 (Manager) - Auto-approved
    // Role 2 (HR) and Role 3 (Employee) - Pending
    const userRole = req.user.role;
    const initialStatus = userRole === 1 ? "approved" : "pending";

    const leave = new Leave({
      userId: req.user.userId,
      employeeId: employee._id,
      leaveType,
      startDate: start,
      endDate: end,
      numberOfDays,
      reason,
      attachments: attachments || [],
      status: initialStatus,
    });

    if (initialStatus === "approved") {
      if (leaveType === "vacation") {
        employee.usedVacationCredits = (employee.usedVacationCredits || 0) + numberOfDays;
      } else if (leaveType === "sick") {
        employee.usedSickCredits = (employee.usedSickCredits || 0) + numberOfDays;
      }
      leave.approvedBy = req.user.userId;
      leave.approvedAt = new Date();
      await employee.save(); // ✅ now valid
    }

    await leave.save();

    return res.status(201).json({
      message: initialStatus === "approved"
        ? "Leave automatically approved"
        : "Leave application submitted successfully",
      leave,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
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
    
    // If approving, directly subtract from available credits
    if (status === "approved") {
      const employee = leave.employeeId;
      let shouldDeduct = true;
      if (leave.pendingDeduction) {
        // Check if employee now has 6+ months tenure
        const hireDate = new Date(employee.dateHired);
        const now = new Date();
        const yearsDiff = now.getFullYear() - hireDate.getFullYear();
        const monthsDiff = now.getMonth() - hireDate.getMonth();
        const totalMonths = yearsDiff * 12 + monthsDiff;
        shouldDeduct = totalMonths >= 6;
        if (shouldDeduct) {
          leave.pendingDeduction = false;
        }
      }
      if (shouldDeduct) {
        if (leave.leaveType === "vacation") {
          employee.vacationCredits = Math.max(0, (employee.vacationCredits || 0) - leave.numberOfDays);
        } else if (leave.leaveType === "sick") {
          employee.sickCredits = Math.max(0, (employee.sickCredits || 0) - leave.numberOfDays);
        }
        await employee.save();
      }
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

// Leaves monitor summary (for managers/HR)
// Returns per-employee totals by leave type and grand totals.
router.get("/monitor-summary", verifyToken, async (req, res) => {
  try {
    const role = req.user.role;
    if (role !== 1 && role !== 2) {
      return res.status(403).json({ error: "Access denied" });
    }


    const { status } = req.query;
    const employees = await Employee.find({}).select(
      "userId firstName lastName position department vacationCredits sickCredits leaveCreditsMode"
    );

    const rowsByEmployeeId = new Map();

    employees.forEach((employee) => {
      const employeeId = String(employee._id);
      const userId = employee.userId ? String(employee.userId) : null;
      rowsByEmployeeId.set(employeeId, {
        employeeId,
        userId,
        fullName: `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || "Unknown",
        position: employee.position || "N/A",
        department: employee.department || "N/A",
        leaveCredits:
          (Number(employee.vacationCredits) || 0) +
          (Number(employee.sickCredits) || 0),
        vacation: Number(employee.vacationCredits) || 0,
        sick: Number(employee.sickCredits) || 0,
        total:
          (Number(employee.vacationCredits) || 0) +
          (Number(employee.sickCredits) || 0),
        leaveCreditsMode: employee.leaveCreditsMode || "auto",
      });
    });

    const rows = Array.from(rowsByEmployeeId.values()).sort((a, b) =>
      a.fullName.localeCompare(b.fullName)
    );

    const grandTotals = rows.reduce(
      (acc, row) => {
        acc.vacation += row.vacation;
        acc.sick += row.sick;
        acc.total += row.total;
        return acc;
      },
      { vacation: 0, sick: 0, total: 0 }
    );

    res.json({
      rows,
      grandTotals,
      totalEmployees: rows.length,
      statusFilter: status || "all",
      syncedAt: new Date(),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update leave credits for an employee (HR/Manager only)
router.post("/update-credits", verifyToken, async (req, res) => {
  try {
    const role = req.user.role;
    if (role !== 1 && role !== 2) {
      return res.status(403).json({ error: "Access denied" });
    }
    const { rowId, vacation, sick } = req.body;
    if (!rowId || vacation == null || sick == null) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const employee = await Employee.findById(rowId);
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }
      employee.vacationCredits = Number(vacation);
      employee.sickCredits = Number(sick);
      employee.leaveCreditsMode = 'manual';
      employee.lastLeaveCalculation = new Date();
      await employee.save();
      res.json({ message: "Leave credits updated successfully", employee });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
