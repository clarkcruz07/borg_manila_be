const express = require("express");
const multer = require("multer");
const fs = require("fs");
const crypto = require("crypto");
const { extractText } = require("../services/ocr");
const { analyzeReceiptText, analyzeReceiptImage } = require("../services/gemini");
const { verifyToken } = require("../middleware/auth");
const Receipt = require("../models/Receipt");
const Employee = require("../models/Employee");
const Job = require("../models/Job");
const { saveReceiptAsJPG, createFolderStructureAsync } = require("../services/fileManager");
const { cleanExtractedData } = require("../services/textCleaner");
const { cloudinary, USE_CLOUDINARY } = require("../config/cloudinary");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

function normalizeMonthYearKey(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  // YYYY-MM format for month-year grouping
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

// Generate SHA-256 hash of file for duplicate detection
function computeFileHash(filePath) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash("sha256").update(fileBuffer).digest("hex");
  } catch (err) {
    console.error("Error computing file hash:", err);
    return null;
  }
}

// Generate receipt fingerprint from extracted data
// Uses: TIN + normalized date + normalized amount + shop name
function generateReceiptKey(extracted) {
  if (!extracted) return null;
  
  // Normalize and clean TIN (remove all non-alphanumeric except dashes, then remove dashes)
  const tin = (extracted.tinNumber || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-/g, "")
    .replace(/\s+/g, "");
  
  // Normalize shop name (lowercase, remove extra spaces)
  const shop = (extracted.shopName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "");
  
  // Normalize date to YYYY-MM-DD format - handle various date formats
  let dateNormalized = "";
  if (extracted.date) {
    try {
      // Try parsing the date string (handles formats like "September 14, 2025")
      const d = new Date(extracted.date);
      if (!Number.isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2100) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        dateNormalized = `${yyyy}-${mm}-${dd}`;
      }
    } catch (err) {
      console.error("Date parsing error:", err, "for date:", extracted.date);
    }
  }
  
  // Normalize amount (remove currency symbols, spaces, commas, keep only digits and decimal)
  const amount = (extracted.amountDue || "")
    .replace(/[₱$,\s]/g, "")
    .replace(/[^\d.]/g, "")
    .trim();
  
  // Create fingerprint string - use empty string if field is missing
  const fingerprint = `${tin}|${dateNormalized}|${amount}|${shop}`;
  
  // Only generate key if we have at least TIN or amount (minimum required for duplicate detection)
  if (!tin && !amount) {
    console.warn("Cannot generate receiptKey: missing both TIN and amount", extracted);
    return null;
  }
  
  // Return SHA-256 hash of fingerprint
  return crypto.createHash("sha256").update(fingerprint).digest("hex");
}

// Protected receipt upload – requires valid JWT token
// Now creates a job for background processing instead of processing immediately
router.post("/upload", verifyToken, upload.single("receipt"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    let cloudinaryUrl = null;

    // Upload to Cloudinary immediately if enabled (required for stateless environments like Cloud Run)
    if (USE_CLOUDINARY) {
      try {
        console.log(`Uploading to Cloudinary: ${filePath}`);
        const result = await cloudinary.uploader.upload(filePath, {
          folder: 'receipts/pending', // Temporary folder for unprocessed receipts
          resource_type: 'image'
        });
        cloudinaryUrl = result.secure_url;
        console.log(`Uploaded to Cloudinary: ${cloudinaryUrl}`);
        
        // Delete local file after successful Cloudinary upload
        fs.unlinkSync(filePath);
        console.log(`Deleted local file: ${filePath}`);
      } catch (uploadErr) {
        console.error('Cloudinary upload error:', uploadErr);
        // Continue with local path as fallback
      }
    }

    // Create job for background processing
    const job = await Job.create({
      userId: req.user.userId,
      filePath: cloudinaryUrl || filePath, // Use Cloudinary URL if available, otherwise local path
      originalName: req.file.originalname,
      status: 'pending',
      cloudinaryUrl: cloudinaryUrl // Set if uploaded to Cloudinary
    });

    console.log(`Job created: ${job._id} for user ${req.user.userId}`);

    // Return job ID immediately
    res.json({
      jobId: job._id,
      message: "Receipt uploaded successfully. Processing in background...",
      status: "pending"
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    
    // Clean up uploaded file on error
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      error: err.message,
      stack: err.stack
    });
  }
});

// Cancel/delete a job
router.delete("/jobs/:jobId", verifyToken, async (req, res) => {
  try {
    console.log(`\n→ DELETE /jobs/${req.params.jobId} called`);
    
    const job = await Job.findOne({
      _id: req.params.jobId,
      userId: req.user.userId
    });

    if (!job) {
      console.log(`  ✗ Job not found: ${req.params.jobId}`);
      return res.status(404).json({ error: "Job not found" });
    }

    console.log(`  ✓ Job found:`, {
      id: job._id,
      status: job.status,
      filePath: job.filePath,
      cloudinaryUrl: job.cloudinaryUrl || 'NOT SET'
    });

    // Allow deletion of any job (pending, processing, completed, failed)
    // Update status to cancelled
    job.status = 'cancelled';
    await job.save();
    console.log(`  ✓ Job status updated to cancelled`);

    // Clean up Cloudinary file if it exists
    if (job.cloudinaryUrl && USE_CLOUDINARY) {
      try {
        console.log(`  → Job cloudinaryUrl:`, job.cloudinaryUrl);
        
        // Extract public_id from Cloudinary URL
        // URL format: https://res.cloudinary.com/{cloud_name}/image/upload/v{version}/{folder}/{public_id}.{format}
        // Decode URL first to handle encoded characters like %2C (comma)
        const decodedUrl = decodeURIComponent(job.cloudinaryUrl);
        console.log(`  → Decoded URL:`, decodedUrl);
        
        const urlParts = decodedUrl.split('/');
        const fileWithExtension = urlParts[urlParts.length - 1];
        const fileName = fileWithExtension.split('.')[0];
        
        // Reconstruct full public_id with folder path
        const uploadIndex = urlParts.indexOf('upload');
        // Get everything after 'upload' except the last part (which is the filename)
        // Skip version number (starts with 'v' followed by digits)
        let startIndex = uploadIndex + 1;
        if (urlParts[startIndex] && /^v\d+$/.test(urlParts[startIndex])) {
          startIndex++; // Skip version number
        }
        
        const folderParts = urlParts.slice(startIndex, -1);
        const publicId = [...folderParts, fileName].join('/');
        
        console.log(`  → Attempting to delete from Cloudinary with public_id: ${publicId}`);
        const result = await cloudinary.uploader.destroy(publicId);
        console.log(`  ✓ Cloudinary deletion result:`, result);
        
        if (result.result === 'not found') {
          console.warn(`  ⚠️  File not found in Cloudinary, may have been already deleted`);
        } else if (result.result === 'ok') {
          console.log(`  ✓ Successfully deleted from Cloudinary`);
        }
      } catch (cloudinaryError) {
        console.error("  ✗ Failed to delete from Cloudinary:", cloudinaryError.message);
        console.error("  ✗ Stack:", cloudinaryError.stack);
        // Continue anyway - file might already be deleted
      }
    } else if (!job.cloudinaryUrl) {
      console.log(`  → No cloudinaryUrl found on job, skipping Cloudinary deletion`);
    }

    // Clean up local file if it exists
    if (job.filePath && !job.filePath.startsWith('http://') && !job.filePath.startsWith('https://')) {
      if (fs.existsSync(job.filePath)) {
        fs.unlinkSync(job.filePath);
      }
    }

    res.json({ message: "Job cancelled and files deleted successfully" });
  } catch (err) {
    console.error("Cancel job error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get job status by job ID
router.get("/jobs/:jobId", verifyToken, async (req, res) => {
  try {
    const job = await Job.findOne({
      _id: req.params.jobId,
      userId: req.user.userId // Ensure user can only access their own jobs
    });

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({
      jobId: job._id,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      processedAt: job.processedAt
    });
  } catch (err) {
    console.error("Job status error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get all jobs for current user
router.get("/jobs", verifyToken, async (req, res) => {
  try {
    const { status } = req.query;
    
    const query = { userId: req.user.userId };
    if (status) {
      query.status = status;
    }

    const jobs = await Job.find(query)
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ jobs });
  } catch (err) {
    console.error("Jobs list error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Save uploaded receipt + extracted fields to DB (protected)
router.post("/", verifyToken, async (req, res) => {
  try {
    const { filePath, originalName, extracted, jobId } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: "filePath is required" });
    }

    // Check if filePath is a Cloudinary URL
    const isCloudinaryUrl = filePath.startsWith('http://') || filePath.startsWith('https://');

    // Generate receipt fingerprint for same-receipt detection (check before conversion)
    const receiptKey = generateReceiptKey(extracted);

    console.log("Duplicate check - receiptKey:", receiptKey ? receiptKey.substring(0, 16) + "..." : "null");
    console.log("Duplicate check - extracted:", JSON.stringify(extracted, null, 2));

    // Check for duplicate receipt (same receipt data, different photo) - do this BEFORE conversion
    if (receiptKey) {
      const duplicateReceipt = await Receipt.findOne({
        userId: req.user.userId,
        receiptKey,
      });
      
      if (duplicateReceipt) {
        console.log("Duplicate receipt detected:", duplicateReceipt._id);
        return res.status(409).json({
          error: "Duplicate receipt detected: A receipt with the same details (TIN, date, amount, shop) already exists",
        });
      }
    }

    let jpgFilePath = filePath;
    let jpgFileHash = null;

    // Only convert to JPG and compute hash if it's a local file
    if (!isCloudinaryUrl) {
      // Convert to JPG and save to employee folder structure
      jpgFilePath = await saveReceiptAsJPG(filePath, req.user.userId, extracted?.date, Employee);
      
      // Compute file hash for exact duplicate detection (on the JPG file)
      jpgFileHash = computeFileHash(jpgFilePath);
      
      // Check for duplicate file (exact same file uploaded) - after conversion
      if (jpgFileHash) {
        const duplicateFile = await Receipt.findOne({
          userId: req.user.userId,
          fileHash: jpgFileHash,
        });
        
        if (duplicateFile) {
          console.log("Duplicate file detected:", duplicateFile._id);
          // Clean up the JPG file we just created
          fs.promises
            .unlink(jpgFilePath)
            .catch(err => console.warn("Could not delete duplicate JPG:", err));
          return res.status(409).json({
            error: "Duplicate receipt detected: This exact file has already been uploaded",
          });
        }
      }
    } else {
      console.log("Cloudinary URL detected, skipping JPG conversion and file hash");
    }
    
    if (!receiptKey) {
      // If receiptKey is null, do a fallback check using actual field values
      // This handles cases where date parsing fails but we still have TIN + amount
      const tin = (extracted?.tinNumber || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      const amount = (extracted?.amountDue || "").replace(/[₱$,\s]/g, "").replace(/[^\d.]/g, "").trim();
      
      if (tin && amount) {
        // Check for existing receipt with same TIN and amount (within same month)
        const monthYearKey = normalizeMonthYearKey(extracted?.date) || normalizeMonthYearKey(new Date().toISOString());
        const existingReceipt = await Receipt.findOne({
          userId: req.user.userId,
          monthYearKey,
          "extracted.tinNumber": { $regex: new RegExp(tin.replace(/[^A-Z0-9]/g, ""), "i") },
          "extracted.amountDue": { $regex: new RegExp(amount, "i") },
        });
        
        if (existingReceipt) {
          console.log("Duplicate receipt detected (fallback check):", existingReceipt._id);
          // Clean up the JPG file we just created (use promises API)
          fs.promises
            .unlink(jpgFilePath)
            .catch(err => console.warn("Could not delete duplicate JPG:", err));
          return res.status(409).json({
            error: "Duplicate receipt detected: A receipt with the same TIN and amount already exists",
          });
        }
      }
    }

    const monthYearKey =
      normalizeMonthYearKey(extracted?.date) ||
      normalizeMonthYearKey(new Date().toISOString());

    // Ensure receiptKey is not null - if it is, generate a fallback key
    let finalReceiptKey = receiptKey;
    if (!finalReceiptKey) {
      // Fallback: use TIN + amount + shop if available
      const tin = (extracted?.tinNumber || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      const amount = (extracted?.amountDue || "").replace(/[₱$,\s]/g, "").replace(/[^\d.]/g, "").trim();
      const shop = (extracted?.shopName || "").trim().toLowerCase().replace(/\s+/g, "");
      if (tin || amount) {
        const fallbackFingerprint = `${tin}|${amount}|${shop}`;
        finalReceiptKey = crypto.createHash("sha256").update(fallbackFingerprint).digest("hex");
      }
    }

    const receipt = await Receipt.create({
      userId: req.user.userId,
      filePath: jpgFilePath, // Now points to JPG in organized folder
      originalName: originalName || null,
      extracted: {
        shopName: extracted?.shopName ?? null,
        tinNumber: extracted?.tinNumber ?? null,
        amountDue: extracted?.amountDue ?? null,
        address: extracted?.address ?? null,
        date: extracted?.date ?? null,
      },
      monthYearKey,
      fileHash: jpgFileHash || null, // Use JPG file hash
      receiptKey: finalReceiptKey || null,
    });

    console.log("Receipt saved successfully as JPG:", receipt._id, "at", jpgFilePath);
    
    // Delete the completed job from MongoDB after successful save
    if (jobId) {
      try {
        await Job.findByIdAndDelete(jobId);
        console.log(`✓ Deleted completed job: ${jobId}`);
      } catch (jobDeleteError) {
        console.error("Failed to delete job:", jobDeleteError.message);
        // Don't fail the request if job deletion fails
      }
    }
    
    res.status(201).json(receipt);
  } catch (err) {
    console.error("RECEIPT SAVE ERROR:", err);
    
    // Handle MongoDB duplicate key error
    if (err.code === 11000) {
      return res.status(409).json({
        error: "Duplicate receipt detected: This receipt already exists in your records",
      });
    }
    
    res.status(500).json({ error: err.message });
  }
});

// Get my saved receipts (protected)
router.get("/", verifyToken, async (req, res) => {
  try {
    const receipts = await Receipt.find({ userId: req.user.userId })
      .sort({ monthYearKey: -1, createdAt: -1 })
      .lean();

    // Convert absolute paths to relative paths for frontend
    const receiptsWithRelativePaths = receipts.map(receipt => ({
      ...receipt,
      filePath: receipt.filePath ? receipt.filePath.replace(/\\/g, "/").split("uploads/")[1] : null
    }));

    res.json({ total: receiptsWithRelativePaths.length, receipts: receiptsWithRelativePaths });
  } catch (err) {
    console.error("RECEIPT LIST ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// Manager endpoint: Get all receipts with date filtering (role 1 only)
router.get("/manager/all", verifyToken, async (req, res) => {
  try {
    // Check if user is Manager (role 1)
    if (req.user.role !== 1) {
      return res.status(403).json({ error: "Access denied: Manager role required" });
    }

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Start date and end date are required" });
    }

    // Build query to filter by date
    const query = {};
    
    // Filter by extracted date (parse the date string from extracted.date)
    // We'll do a simple text comparison since dates are stored as strings
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // Include the entire end date

    // Find all receipts and filter by parsed date
    const allReceipts = await Receipt.find({})
      .populate({
        path: "userId",
        select: "email"
      })
      .sort({ createdAt: -1 })
      .lean();

    // Filter receipts by date range
    const filteredReceipts = allReceipts.filter(receipt => {
      if (!receipt.extracted?.date) return false;
      
      try {
        const receiptDate = new Date(receipt.extracted.date);
        return receiptDate >= start && receiptDate <= end;
      } catch (err) {
        return false;
      }
    });

    // Populate user names from Employee collection
    const receiptsWithUserInfo = await Promise.all(
      filteredReceipts.map(async (receipt) => {
        try {
          const employee = await Employee.findOne({ userId: receipt.userId?._id });
          
          // Convert absolute path to relative path for frontend
          const relativePath = receipt.filePath 
            ? receipt.filePath.replace(/\\/g, "/").split("uploads/")[1] 
            : null;
          
          return {
            ...receipt,
            filePath: relativePath,
            userId: {
              _id: receipt.userId?._id,
              email: receipt.userId?.email,
              firstName: employee?.firstName || "Unknown",
              lastName: employee?.lastName || "User",
            }
          };
        } catch (err) {
          return {
            ...receipt,
            filePath: receipt.filePath 
              ? receipt.filePath.replace(/\\/g, "/").split("uploads/")[1] 
              : null,
            userId: {
              _id: receipt.userId?._id,
              email: receipt.userId?.email,
              firstName: "Unknown",
              lastName: "User",
            }
          };
        }
      })
    );

    res.json({
      total: receiptsWithUserInfo.length,
      receipts: receiptsWithUserInfo
    });
  } catch (err) {
    console.error("MANAGER RECEIPT LIST ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
