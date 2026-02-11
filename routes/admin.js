const express = require("express");
const router = express.Router();
const Department = require("../models/Department");
const Company = require("../models/Company");
const { verifyToken } = require("../middleware/auth");

// Middleware to ensure user is a Manager (role #1)
const ensureManager = (req, res, next) => {
  if (req.user.role !== 1) {
    return res.status(403).json({ error: "Access denied. Manager role required." });
  }
  next();
};

// ==================== DEPARTMENT ROUTES ====================

// Get all departments
router.get("/departments", verifyToken, ensureManager, async (req, res) => {
  try {
    const departments = await Department.find().sort({ name: 1 });
    res.json(departments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create department
router.post("/departments", verifyToken, ensureManager, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({ error: "Department name is required" });
    }

    const existingDept = await Department.findOne({ name: name.trim() });
    if (existingDept) {
      return res.status(400).json({ error: "Department already exists" });
    }

    const department = new Department({
      name: name.trim(),
      description: description || "",
    });

    await department.save();
    res.status(201).json(department);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update department
router.put("/departments/:id", verifyToken, ensureManager, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({ error: "Department name is required" });
    }

    // Check if another department has the same name
    const existingDept = await Department.findOne({ 
      name: name.trim(),
      _id: { $ne: req.params.id }
    });
    if (existingDept) {
      return res.status(400).json({ error: "Department name already exists" });
    }

    const department = await Department.findByIdAndUpdate(
      req.params.id,
      { name: name.trim(), description: description || "" },
      { new: true }
    );

    if (!department) {
      return res.status(404).json({ error: "Department not found" });
    }

    res.json(department);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete department
router.delete("/departments/:id", verifyToken, ensureManager, async (req, res) => {
  try {
    const department = await Department.findByIdAndDelete(req.params.id);

    if (!department) {
      return res.status(404).json({ error: "Department not found" });
    }

    res.json({ message: "Department deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== COMPANY ROUTES ====================

// Get all companies (accessible to all authenticated users for profile selection)
router.get("/companies", verifyToken, async (req, res) => {
  try {
    const companies = await Company.find().sort({ name: 1 });
    res.json(companies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create company (manager only)
router.post("/companies", verifyToken, ensureManager, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({ error: "Company name is required" });
    }

    const existingCompany = await Company.findOne({ name: name.trim() });
    if (existingCompany) {
      return res.status(400).json({ error: "Company already exists" });
    }

    const company = new Company({
      name: name.trim(),
      description: description || "",
    });

    await company.save();
    res.status(201).json(company);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update company
router.put("/companies/:id", verifyToken, ensureManager, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || name.trim() === "") {
      return res.status(400).json({ error: "Company name is required" });
    }

    // Check if another company has the same name
    const existingCompany = await Company.findOne({ 
      name: name.trim(),
      _id: { $ne: req.params.id }
    });
    if (existingCompany) {
      return res.status(400).json({ error: "Company name already exists" });
    }

    const company = await Company.findByIdAndUpdate(
      req.params.id,
      { name: name.trim(), description: description || "" },
      { new: true }
    );

    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    res.json(company);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete company
router.delete("/companies/:id", verifyToken, ensureManager, async (req, res) => {
  try {
    const company = await Company.findByIdAndDelete(req.params.id);

    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    res.json({ message: "Company deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
