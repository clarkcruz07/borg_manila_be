const express = require("express");
const Asset = require("../models/Asset");
const AssetRequest = require("../models/AssetRequest");
const Employee = require("../models/Employee");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

// Middleware to check if user is IT department
async function ensureIT(req, res, next) {
  try {
    // Check if user's department is IT
    const employee = await Employee.findOne({ userId: req.user.userId });
    if (!employee) {
      return res.status(403).json({ error: "Employee profile not found" });
    }
    
    if (employee.department && employee.department.toLowerCase() === "it") {
      return next();
    }
    
    return res.status(403).json({ error: "Access denied: Only IT department can manage assets" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// Get all assets (all employees can view)
router.get("/", verifyToken, async (req, res) => {
  try {
    const role = req.user?.role;
    const employee = await Employee.findOne({ userId: req.user.userId });
    
    if (!employee) {
      return res.status(404).json({ error: "Employee profile not found" });
    }
    
    let assets;
    const isIT = employee.department && employee.department.toLowerCase() === "it";
    
    if (isIT) {
      // IT can see all assets
      assets = await Asset.find()
        .populate("assignedTo", "firstName lastName position department")
        .populate("createdBy", "email")
        .sort({ createdAt: -1 });
    } else {
      // Regular employees only see their assigned assets
      assets = await Asset.find({ assignedTo: employee._id })
        .populate("assignedTo", "firstName lastName position department")
        .populate("createdBy", "email")
        .sort({ createdAt: -1 });
    }
    
    res.json({ assets, isIT });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single asset by ID
router.get("/:id", verifyToken, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id)
      .populate("assignedTo", "firstName lastName position department")
      .populate("createdBy", "email")
      .populate("updatedBy", "email");
    
    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }
    
    res.json(asset);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new asset (IT only)
router.post("/", verifyToken, ensureIT, async (req, res) => {
  try {
    const {
      assetTag,
      assetType,
      brand,
      model,
      serialNumber,
      specifications,
      purchaseDate,
      purchaseCost,
      warrantyExpiry,
      status,
      assignedTo,
      assignedDate,
      location,
      notes,
    } = req.body;

    if (!assetTag || !assetType) {
      return res.status(400).json({ error: "Asset tag and type are required" });
    }

    // Check if asset tag already exists
    const existingAsset = await Asset.findOne({ assetTag });
    if (existingAsset) {
      return res.status(400).json({ error: "Asset tag already exists" });
    }

    const asset = new Asset({
      assetTag,
      assetType,
      brand,
      model,
      serialNumber,
      specifications,
      purchaseDate,
      purchaseCost,
      warrantyExpiry,
      status: status || "Available",
      assignedTo: assignedTo || null,
      assignedDate: assignedTo ? (assignedDate || new Date()) : null,
      location,
      notes,
      createdBy: req.user.userId,
    });

    await asset.save();
    
    const populatedAsset = await Asset.findById(asset._id)
      .populate("assignedTo", "firstName lastName position department")
      .populate("createdBy", "email");
    
    res.status(201).json({
      message: "Asset created successfully",
      asset: populatedAsset,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update asset (IT only)
router.put("/:id", verifyToken, ensureIT, async (req, res) => {
  try {
    const {
      assetTag,
      assetType,
      brand,
      model,
      serialNumber,
      specifications,
      purchaseDate,
      purchaseCost,
      warrantyExpiry,
      status,
      assignedTo,
      assignedDate,
      location,
      notes,
    } = req.body;

    const asset = await Asset.findById(req.params.id);
    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }

    // Check if new asset tag conflicts with existing ones
    if (assetTag && assetTag !== asset.assetTag) {
      const existingAsset = await Asset.findOne({ assetTag });
      if (existingAsset) {
        return res.status(400).json({ error: "Asset tag already exists" });
      }
    }

    // Update fields
    if (assetTag) asset.assetTag = assetTag;
    if (assetType) asset.assetType = assetType;
    if (brand !== undefined) asset.brand = brand;
    if (model !== undefined) asset.model = model;
    if (serialNumber !== undefined) asset.serialNumber = serialNumber;
    if (specifications !== undefined) asset.specifications = specifications;
    if (purchaseDate !== undefined) asset.purchaseDate = purchaseDate;
    if (purchaseCost !== undefined) asset.purchaseCost = purchaseCost;
    if (warrantyExpiry !== undefined) asset.warrantyExpiry = warrantyExpiry;
    if (status !== undefined) asset.status = status;
    if (location !== undefined) asset.location = location;
    if (notes !== undefined) asset.notes = notes;
    
    // Handle assignment
    if (assignedTo !== undefined) {
      asset.assignedTo = assignedTo || null;
      asset.assignedDate = assignedTo ? (assignedDate || new Date()) : null;
    }
    
    asset.updatedBy = req.user.userId;

    await asset.save();
    
    const populatedAsset = await Asset.findById(asset._id)
      .populate("assignedTo", "firstName lastName position department")
      .populate("createdBy", "email")
      .populate("updatedBy", "email");
    
    res.json({
      message: "Asset updated successfully",
      asset: populatedAsset,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete asset (IT only)
router.delete("/:id", verifyToken, ensureIT, async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);
    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }

    await Asset.findByIdAndDelete(req.params.id);
    
    res.json({ message: "Asset deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all employees for assignment dropdown (IT only)
router.get("/employees/list", verifyToken, ensureIT, async (req, res) => {
  try {
    const employees = await Employee.find({ approval_status: 1 })
      .select("firstName lastName position department")
      .sort({ firstName: 1, lastName: 1 });
    
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========== ASSET REQUEST ROUTES ==========

// Create asset request (all employees)
router.post("/requests", verifyToken, async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.userId });
    if (!employee) {
      return res.status(404).json({ error: "Employee profile not found" });
    }

    const { assetType, specifications, justification, priority } = req.body;

    if (!assetType || !justification) {
      return res.status(400).json({ error: "Asset type and justification are required" });
    }

    const assetRequest = new AssetRequest({
      requestedBy: employee._id,
      assetType,
      specifications,
      justification,
      priority: priority || "Medium",
      status: "Pending",
    });

    await assetRequest.save();

    const populatedRequest = await AssetRequest.findById(assetRequest._id)
      .populate("requestedBy", "firstName lastName position department");

    res.status(201).json({
      message: "Asset request submitted successfully",
      request: populatedRequest,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get asset requests
router.get("/requests/all", verifyToken, async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.user.userId });
    if (!employee) {
      return res.status(404).json({ error: "Employee profile not found" });
    }

    const isIT = employee.department && employee.department.toLowerCase() === "it";

    let requests;
    if (isIT) {
      // IT can see all requests
      requests = await AssetRequest.find()
        .populate("requestedBy", "firstName lastName position department")
        .populate("approvedBy", "email")
        .populate("deployedBy", "email")
        .populate("assignedAsset")
        .sort({ createdAt: -1 });
    } else {
      // Regular employees only see their own requests
      requests = await AssetRequest.find({ requestedBy: employee._id })
        .populate("requestedBy", "firstName lastName position department")
        .populate("approvedBy", "email")
        .populate("deployedBy", "email")
        .populate("assignedAsset")
        .sort({ createdAt: -1 });
    }

    res.json({ requests, isIT });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Approve asset request (IT only)
router.put("/requests/:id/approve", verifyToken, ensureIT, async (req, res) => {
  try {
    const request = await AssetRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.status !== "Pending") {
      return res.status(400).json({ error: "Only pending requests can be approved" });
    }

    request.status = "Approved";
    request.approvedBy = req.user.userId;
    request.approvedDate = new Date();

    await request.save();

    const populatedRequest = await AssetRequest.findById(request._id)
      .populate("requestedBy", "firstName lastName position department")
      .populate("approvedBy", "email")
      .populate("deployedBy", "email");

    res.json({
      message: "Request approved successfully",
      request: populatedRequest,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reject asset request (IT only)
router.put("/requests/:id/reject", verifyToken, ensureIT, async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    
    const request = await AssetRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.status !== "Pending") {
      return res.status(400).json({ error: "Only pending requests can be rejected" });
    }

    request.status = "Rejected";
    request.rejectionReason = rejectionReason || "Not specified";
    request.approvedBy = req.user.userId;
    request.approvedDate = new Date();

    await request.save();

    const populatedRequest = await AssetRequest.findById(request._id)
      .populate("requestedBy", "firstName lastName position department")
      .populate("approvedBy", "email");

    res.json({
      message: "Request rejected",
      request: populatedRequest,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deploy asset (IT only)
router.put("/requests/:id/deploy", verifyToken, ensureIT, async (req, res) => {
  try {
    const { assetId, itNotes, newAsset } = req.body;
    
    const request = await AssetRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.status !== "Approved") {
      return res.status(400).json({ error: "Only approved requests can be deployed" });
    }

    let assetToAssign = null;

    // If assetId provided, link to existing asset and update it
    if (assetId) {
      const asset = await Asset.findById(assetId);
      if (!asset) {
        return res.status(404).json({ error: "Asset not found" });
      }

      // Update asset to be assigned to the requester
      asset.status = "Assigned";
      asset.assignedTo = request.requestedBy;
      asset.assignedDate = new Date();
      asset.updatedBy = req.user.userId;
      await asset.save();

      assetToAssign = asset._id;
    } 
    // If newAsset details provided, create a new asset
    else if (newAsset) {
      const asset = new Asset({
        ...newAsset,
        status: "Assigned",
        assignedTo: request.requestedBy,
        assignedDate: new Date(),
        createdBy: req.user.userId,
        updatedBy: req.user.userId,
      });
      await asset.save();
      assetToAssign = asset._id;
    }

    if (assetToAssign) {
      request.assignedAsset = assetToAssign;
    }

    request.status = "Deployed";
    request.deployedBy = req.user.userId;
    request.deployedDate = new Date();
    if (itNotes) request.itNotes = itNotes;

    await request.save();

    const populatedRequest = await AssetRequest.findById(request._id)
      .populate("requestedBy", "firstName lastName position department")
      .populate("approvedBy", "email")
      .populate("deployedBy", "email")
      .populate("assignedAsset");

    res.json({
      message: "Request deployed successfully",
      request: populatedRequest,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available assets for deployment (IT only)
router.get("/inventory/available", verifyToken, ensureIT, async (req, res) => {
  try {
    const { assetType } = req.query;
    
    const query = { status: "Available" };
    if (assetType && assetType !== "All") {
      query.assetType = assetType;
    }

    const assets = await Asset.find(query)
      .select("assetTag assetType brand model serialNumber")
      .sort({ assetType: 1, assetTag: 1 });

    res.json(assets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
