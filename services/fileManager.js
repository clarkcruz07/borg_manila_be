const fs = require("fs").promises;
const path = require("path");
const sharp = require("sharp");
const crypto = require("crypto");

/**
 * Get employee folder name in format "lastname, firstname"
 */
async function getEmployeeFolderName(userId, Employee) {
  try {
    const employee = await Employee.findOne({ userId });
    if (!employee || !employee.firstName || !employee.lastName) {
      // Fallback to userId if employee profile not found
      return `user_${userId}`;
    }
    // Format: "lastname, firstname" - sanitize for filesystem
    const lastName = employee.lastName.trim().replace(/[<>:"/\\|?*]/g, "_");
    const firstName = employee.firstName.trim().replace(/[<>:"/\\|?*]/g, "_");
    return `${lastName}, ${firstName}`;
  } catch (error) {
    console.error("Error getting employee folder name:", error);
    return `user_${userId}`;
  }
}

/**
 * Get year and month from date string or use current date
 */
function getYearMonth(dateStr) {
  let date;
  if (dateStr) {
    date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      date = new Date();
    }
  } else {
    date = new Date();
  }
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return { year, month };
}

/**
 * Ensure folder structure exists (background process - doesn't block)
 * Structure: uploads/{lastname}, {firstname}/{year}/{month}/
 */
async function ensureFolderStructure(userId, dateStr, Employee) {
  try {
    const employeeFolder = await getEmployeeFolderName(userId, Employee);
    const { year, month } = getYearMonth(dateStr);
    
    const folderPath = path.join(
      process.cwd(),
      "uploads",
      employeeFolder,
      year.toString(),
      month
    );
    
    // Create folder structure recursively (non-blocking)
    await fs.mkdir(folderPath, { recursive: true });
    
    return folderPath;
  } catch (error) {
    console.error("Error creating folder structure:", error);
    // Fallback to default uploads folder
    return path.join(process.cwd(), "uploads");
  }
}

/**
 * Convert image to JPG and save to employee folder structure
 * Returns the new file path
 * Folder creation happens in background (non-blocking) - doesn't slow down save
 */
async function saveReceiptAsJPG(originalFilePath, userId, dateStr, Employee) {
  try {
    // Get folder info quickly (just metadata, no I/O)
    const employeeFolder = await getEmployeeFolderName(userId, Employee);
    const { year, month } = getYearMonth(dateStr);
    
    // Construct target folder path
    const targetFolder = path.join(
      process.cwd(),
      "uploads",
      employeeFolder,
      year.toString(),
      month
    );
    
    // Start folder creation in background (fire and forget - don't wait)
    ensureFolderStructure(userId, dateStr, Employee).catch(err => {
      console.warn("Background folder creation warning:", err);
    });
    
    // Create folder synchronously (mkdir with recursive is very fast, won't block)
    // This ensures folder exists before we try to save the file
    try {
      await fs.mkdir(targetFolder, { recursive: true });
    } catch (mkdirErr) {
      // If mkdir fails, wait a tiny bit for background creation, then retry once
      await new Promise(resolve => setTimeout(resolve, 50));
      try {
        await fs.mkdir(targetFolder, { recursive: true });
      } catch (retryErr) {
        // If still fails, use default uploads folder as fallback
        console.warn("Folder creation failed, using default uploads folder");
        const fallbackFolder = path.join(process.cwd(), "uploads");
        await fs.mkdir(fallbackFolder, { recursive: true });
        const targetFolder = fallbackFolder;
      }
    }
    
    // Generate unique filename (timestamp + random hash)
    const timestamp = Date.now();
    const randomHash = crypto.randomBytes(4).toString("hex");
    const filename = `receipt_${timestamp}_${randomHash}.jpg`;
    const targetPath = path.join(targetFolder, filename);
    
    // Convert to JPG using sharp (handles various input formats)
    await sharp(originalFilePath)
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(targetPath);
    
    // Delete original temporary file (non-blocking)
    fs.unlink(originalFilePath).catch(err => {
      console.warn("Could not delete original file:", err);
    });
    
    return targetPath;
  } catch (error) {
    console.error("Error converting/saving receipt as JPG:", error);
    // Fallback: return original path if conversion fails
    return originalFilePath;
  }
}

/**
 * Background folder creation (fire and forget)
 */
function createFolderStructureAsync(userId, dateStr, Employee) {
  // Don't await - let it run in background
  ensureFolderStructure(userId, dateStr, Employee).catch(err => {
    console.error("Background folder creation error:", err);
  });
}

module.exports = {
  getEmployeeFolderName,
  getYearMonth,
  ensureFolderStructure,
  saveReceiptAsJPG,
  createFolderStructureAsync,
};
