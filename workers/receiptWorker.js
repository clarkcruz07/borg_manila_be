require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const axios = require("axios");
const Job = require("../models/Job");
const Employee = require("../models/Employee");
const { analyzeReceiptImage } = require("../services/gemini");
const { cleanExtractedData } = require("../services/textCleaner");
const { cloudinary, USE_CLOUDINARY } = require("../config/cloudinary");

// MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/borg_manila";

if (!process.env.MONGODB_URI) {
  console.warn("⚠️  Warning: MONGODB_URI not found in .env, using localhost");
}

// Worker configuration
const POLL_INTERVAL = 3000; // Check for new jobs every 3 seconds
const MAX_ATTEMPTS = 3;
const CONCURRENT_JOBS = 2; // Process 2 jobs at a time

let isProcessing = false;
let processingCount = 0;

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (err) {
    console.error(`  ✗ Failed to delete local file ${filePath}:`, err.message);
  }
  return false;
}

function extractCloudinaryPublicIdFromUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const decodedUrl = decodeURIComponent(url);
    const urlParts = decodedUrl.split("/");
    const fileWithExtension = urlParts[urlParts.length - 1];
    const fileName = fileWithExtension.split(".")[0];
    const uploadIndex = urlParts.indexOf("upload");
    if (uploadIndex < 0) return null;

    let startIndex = uploadIndex + 1;
    if (urlParts[startIndex] && /^v\d+$/.test(urlParts[startIndex])) {
      startIndex++;
    }

    const folderParts = urlParts.slice(startIndex, -1);
    return [...folderParts, fileName].join("/");
  } catch (err) {
    console.error("  ✗ Failed to parse Cloudinary public ID:", err.message);
    return null;
  }
}

async function deleteCloudinaryByUrl(url, label = "Cloudinary file") {
  if (!USE_CLOUDINARY || !url) return;
  try {
    const publicId = extractCloudinaryPublicIdFromUrl(url);
    if (!publicId) {
      console.warn(`  ⚠️  Could not derive public_id for ${label}`);
      return;
    }
    const result = await cloudinary.uploader.destroy(publicId);
    console.log(`  ✓ Deleted ${label} from Cloudinary: ${result.result}`);
  } catch (err) {
    console.error(`  ✗ Failed deleting ${label} from Cloudinary:`, err.message);
  }
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized !== "" && normalized !== "null" && normalized !== "undefined" && normalized !== "n/a";
}

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✓ Worker connected to MongoDB");
  } catch (err) {
    console.error("✗ MongoDB connection error:", err);
    process.exit(1);
  }
}

// Timeout wrapper for async operations
function withTimeout(promise, timeoutMs, operationName) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

async function processJob(job) {
  const startTime = Date.now();
  console.log(`\n[${new Date().toISOString()}] Processing job ${job._id}...`);
  
  try {
    // Update status to processing with atomic operation to prevent duplicate processing
    console.log(`  [+${Date.now() - startTime}ms] Updating status to processing...`);
    const updateResult = await Job.updateOne(
      { 
        _id: job._id,
        status: 'pending' // Only update if still pending (prevents race conditions)
      },
      { 
        status: 'processing',
        $inc: { attempts: 1 }
      }
    );
    console.log(`  [+${Date.now() - startTime}ms] Status updated`);

    // If no document was updated, another worker already grabbed it
    if (updateResult.modifiedCount === 0) {
      console.log(`  ⊘ Job ${job._id} already being processed by another worker`);
      return;
    }

    console.log(`  ✓ Job ${job._id} locked for processing`);

    // Handle both local files and Cloudinary URLs
    let localFilePath = job.filePath;
    let tempDownloadedFile = null;

    // If filePath is a Cloudinary URL, download it first
    if (job.filePath.startsWith('http://') || job.filePath.startsWith('https://')) {
      console.log(`  → File is a Cloudinary URL: ${job.filePath}`);
      console.log(`  → Downloading from Cloudinary...`);
      try {
        const response = await axios.get(job.filePath, { 
          responseType: 'arraybuffer',
          timeout: 30000 // 30 second timeout
        });
        
        console.log(`  ✓ Download successful (${response.data.byteLength} bytes)`);
        
        const tempDir = path.join(__dirname, '..', 'uploads', 'temp');
        
        // Create temp directory if it doesn't exist
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
          console.log(`  ✓ Created temp directory: ${tempDir}`);
        }
        
        // Create temp file
        tempDownloadedFile = path.join(tempDir, `${job._id}.jpg`);
        fs.writeFileSync(tempDownloadedFile, response.data);
        localFilePath = tempDownloadedFile;
        
        const fileSize = fs.statSync(localFilePath).size;
        console.log(`  ✓ Saved to temp file: ${localFilePath} (${(fileSize / 1024).toFixed(0)}KB)`);
      } catch (downloadErr) {
        console.error(`  ✗ Download failed:`, downloadErr.message);
        console.error(`  ✗ URL that failed: ${job.filePath}`);
        console.error(`  ✗ Status: ${downloadErr.response?.status}`);
        console.error(`  ✗ Status text: ${downloadErr.response?.statusText}`);
        throw new Error(`Failed to download from Cloudinary: ${downloadErr.message}`);
      }
    } else {
      // Verify local file exists
      if (!fs.existsSync(job.filePath)) {
        console.error(`  ✗ Local file not found: ${job.filePath}`);
        throw new Error(`Receipt file not found: ${job.filePath}`);
      }
      
      const fileSize = fs.statSync(job.filePath).size;
      console.log(`  ✓ Local file confirmed: ${job.filePath} (${(fileSize / 1024).toFixed(0)}KB)`);
    }

    let extracted;
    
    try {
      // Try Gemini Vision API first
      console.log(`  [+${Date.now() - startTime}ms] → Analyzing with Vision API...`);
      try {
        extracted = await withTimeout(
          analyzeReceiptImage(localFilePath),
          60000, // 60 second timeout
          "Vision API analysis"
        );
        console.log(`  [+${Date.now() - startTime}ms] ✓ Vision API succeeded`);
      } catch (visionError) {
        console.error(`  [+${Date.now() - startTime}ms] ✗ Vision API error:`, visionError.message);
        
        // OCR fallback is temporarily disabled for Groq-only testing.
        /*
        // Fallback to OCR if Vision fails
        console.log("  → Vision failed, falling back to OCR (EasyOCR)");

        // Verify file still exists before OCR
        if (!fs.existsSync(job.filePath)) {
          throw new Error("Receipt file was deleted before OCR could process it");
        }

        console.log("  → Starting OCR extraction...");
        const ocrText = await extractText(job.filePath);
        console.log(`  → OCR extracted ${ocrText.length} characters`);

        if (!ocrText || ocrText.length < 10) {
          throw new Error("OCR extracted insufficient text (possible corrupted image)");
        }

        // Try text analysis on OCR output
        try {
          console.log("  → Analyzing extracted text...");
          extracted = await analyzeReceiptText(ocrText);
          console.log("  → Text analysis complete");
        } catch (textError) {
          console.error("  → Text analysis failed:", textError.message);
          extracted = extractFields(ocrText);
          console.log("  → Pattern parser complete");
        }
        */
        throw visionError;
      }
    } catch (processingError) {
      console.error("  → Receipt extraction failed:", processingError.message);
      throw processingError;
    }
    
    if (!extracted) {
      throw new Error("Failed to extract data from receipt");
    }

    // Clean the extracted data
    console.log("  → Cleaning extracted data...");
    const cleanedExtracted = cleanExtractedData(extracted);
    
    console.log("  ✓ Extraction complete:", {
      shop: cleanedExtracted.shopName,
      amount: cleanedExtracted.amountDue,
      date: cleanedExtracted.date
    });

    // Hard-stop invalid extraction: date and amount are required for reimbursement workflows.
    const missingFields = [];
    if (!hasValue(cleanedExtracted.date)) missingFields.push("date");
    if (!hasValue(cleanedExtracted.amountDue)) missingFields.push("amountDue");

    if (missingFields.length > 0) {
      const missingLabel = missingFields.join(", ");
      const errorMessage = `Required receipt fields not found (${missingLabel}). File deleted. Please re-upload this receipt.`;
      console.warn(`  ⚠️  ${errorMessage}`);

      // Remove Cloudinary pending asset for this job (if any).
      if (job.cloudinaryUrl) {
        await deleteCloudinaryByUrl(job.cloudinaryUrl, "pending receipt");
      } else if (job.filePath && (job.filePath.startsWith("http://") || job.filePath.startsWith("https://"))) {
        await deleteCloudinaryByUrl(job.filePath, "receipt");
      }

      // Remove local temp/downloaded files.
      safeUnlink(tempDownloadedFile);
      if (job.filePath && !job.filePath.startsWith("http://") && !job.filePath.startsWith("https://")) {
        safeUnlink(job.filePath);
      }

      // Delete the job so client gets re-upload prompt.
      await Job.deleteOne({ _id: job._id });
      console.log(`  ✓ Deleted job ${job._id} after missing required fields`);
      return;
    }

    // Upload to Cloudinary with date-based folder structure
    let cloudinaryUrl = job.cloudinaryUrl; // Start with existing URL (from pending folder)
    let finalFilePath = job.filePath;
    
    if (USE_CLOUDINARY && fs.existsSync(localFilePath)) {
      try {
        console.log(`  [+${Date.now() - startTime}ms] → Compressing image for Cloudinary...`);
        
        // Compress image: resize to max 1920px width, convert to JPEG with 85% quality
        const compressedPath = path.join(path.dirname(localFilePath), `compressed_${Date.now()}.jpg`);
        
        await withTimeout(
          sharp(localFilePath)
            .resize({ width: 1920, withoutEnlargement: true }) // Don't enlarge small images
            .jpeg({ quality: 85 }) // 85% quality - good balance between size and clarity
            .toFile(compressedPath),
          30000, // 30 second timeout for compression
          "Image compression"
        );
        
        const originalSize = fs.statSync(localFilePath).size;
        const compressedSize = fs.statSync(compressedPath).size;
        const savedPercent = Math.round((1 - compressedSize / originalSize) * 100);
        
        console.log(`  [+${Date.now() - startTime}ms] ✓ Compressed: ${(originalSize / 1024).toFixed(0)}KB → ${(compressedSize / 1024).toFixed(0)}KB (${savedPercent}% reduction)`);
        
        console.log(`  [+${Date.now() - startTime}ms] → Uploading to Cloudinary with date-based folder...`);
        
        // Get employee info for folder structure
        const employee = await Employee.findOne({ userId: job.userId });
        
        // Parse date from extracted data
        let year, month, day;
        if (cleanedExtracted.date) {
          const receiptDate = new Date(cleanedExtracted.date);
          if (!isNaN(receiptDate.getTime())) {
            year = receiptDate.getFullYear();
            month = String(receiptDate.getMonth() + 1).padStart(2, '0');
            day = String(receiptDate.getDate()).padStart(2, '0');
          }
        }
        
        // Fallback to current date if receipt date is invalid
        if (!year) {
          const now = new Date();
          year = now.getFullYear();
          month = String(now.getMonth() + 1).padStart(2, '0');
          day = String(now.getDate()).padStart(2, '0');
        }
        
        // Create folder path: receipts/EmployeeName/YYYY/MM/DD
        let folderPath = `receipts/${job.userId}/${year}/${month}/${day}`;
        if (employee && employee.firstName && employee.lastName) {
          const employeeName = `${employee.lastName}, ${employee.firstName}`;
          folderPath = `receipts/${employeeName}/${year}/${month}/${day}`;
        }
        
        // Upload compressed image to date-based folder
        console.log(`  [+${Date.now() - startTime}ms] → Uploading to folder: ${folderPath}`);
        const result = await withTimeout(
          cloudinary.uploader.upload(compressedPath, {
            folder: folderPath,
            resource_type: "image",
            public_id: `${Date.now()}_${job.originalName.replace(/\.[^/.]+$/, "")}`,
          }),
          60000, // 60 second timeout for upload
          "Cloudinary upload to date folder"
        );

        cloudinaryUrl = result.secure_url;
        finalFilePath = cloudinaryUrl;
        console.log(`  [+${Date.now() - startTime}ms] ✓ Uploaded to Cloudinary: ${cloudinaryUrl}`);

        // Delete the old pending file from Cloudinary if it exists
        if (job.cloudinaryUrl && job.cloudinaryUrl.includes('/receipts/pending/')) {
          try {
            console.log(`  [+${Date.now() - startTime}ms] → Deleting pending file from Cloudinary...`);
            const urlParts = job.cloudinaryUrl.split('/');
            const fileWithExtension = urlParts[urlParts.length - 1];
            const fileName = fileWithExtension.split('.')[0];
            const publicId = `receipts/pending/${fileName}`;
            
            const deleteResult = await withTimeout(
              cloudinary.uploader.destroy(publicId),
              30000, // 30 second timeout for delete
              "Cloudinary pending file deletion"
            );
            console.log(`  [+${Date.now() - startTime}ms] ✓ Deleted pending file: ${deleteResult.result}`);
          } catch (deleteErr) {
            console.error(`  [+${Date.now() - startTime}ms] ⚠️  Failed to delete pending file:`, deleteErr.message);
            // Continue anyway - not critical
          }
        }

        // Clean up compressed temp file
        safeUnlink(compressedPath);
        // Clean up temp downloaded file if it exists
        safeUnlink(tempDownloadedFile);
        console.log(`  [+${Date.now() - startTime}ms] ✓ Local temp files cleaned up`);
      } catch (cloudinaryError) {
        console.error("  ✗ Cloudinary upload failed:", cloudinaryError);
        console.error("  ✗ Stack:", cloudinaryError.stack);
        // Continue with existing cloudinary URL
        finalFilePath = job.cloudinaryUrl || job.filePath;
      }
    }

    // Update job with results
    console.log(`  [+${Date.now() - startTime}ms] → Updating job status to completed...`);
    const completeResult = await Job.updateOne(
      { _id: job._id },
      {
        status: 'completed',
        result: {
          filePath: finalFilePath,
          originalName: job.originalName,
          extracted: cleanedExtracted
        },
        cloudinaryUrl: cloudinaryUrl,
        processedAt: new Date()
      }
    );

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`  [+${Date.now() - startTime}ms] ✓ Job ${job._id} completed successfully in ${totalTime}s (${completeResult.modifiedCount} document updated)`);
    
    // Clean up temp downloaded file if it exists
    if (safeUnlink(tempDownloadedFile)) {
      console.log("  ✓ Temp file cleaned up");
    }
    
  } catch (error) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`  [+${Date.now() - startTime}ms] ✗ Job ${job._id} failed after ${totalTime}s:`, error);
    console.error(`  ✗ Error stack:`, error.stack);
    
    // Clean up temp downloaded file if it exists
    if (safeUnlink(tempDownloadedFile)) {
      console.log("  ✓ Temp file cleaned up after error");
    }
    
    // Check if we should retry
    if (job.attempts < MAX_ATTEMPTS) {
      console.log(`  → Will retry (attempt ${job.attempts + 1}/${MAX_ATTEMPTS})`);
      await Job.updateOne(
        { _id: job._id },
        {
          status: 'pending', // Reset to pending for retry
          error: error.message
        }
      );
    } else {
      console.log(`  ✗ Max attempts reached, marking as failed`);
      await Job.updateOne(
        { _id: job._id },
        {
          status: 'failed',
          error: error.message,
          processedAt: new Date()
        }
      );
      
      // Clean up file on permanent failure (only if local file, not Cloudinary URL)
      if (job.filePath && !job.filePath.startsWith('http://') && !job.filePath.startsWith('https://')) {
        safeUnlink(job.filePath);
      }
    }
  }
}

async function pollJobs() {
  if (isProcessing || processingCount >= CONCURRENT_JOBS) {
    return; // Skip if already processing or at max concurrent jobs
  }

  isProcessing = true;

  try {
    // Find pending jobs, oldest first (exclude jobs being processed)
    const jobs = await Job.find({ 
      status: 'pending'
    })
      .sort({ createdAt: 1 })
      .limit(CONCURRENT_JOBS - processingCount);

    if (jobs.length === 0) {
      isProcessing = false;
      return;
    }

    console.log(`\n[${new Date().toISOString()}] Found ${jobs.length} pending job(s): ${jobs.map(j => j._id).join(', ')}`);

    // Process jobs concurrently (up to CONCURRENT_JOBS)
    const promises = jobs.map(async (job) => {
      processingCount++;
      try {
        await processJob(job);
      } catch (err) {
        console.error(`Unexpected error processing job ${job._id}:`, err);
      } finally {
        processingCount--;
      }
    });

    await Promise.all(promises);
    
  } catch (err) {
    console.error("Poll error:", err);
  } finally {
    isProcessing = false;
  }
}

// Clean up old completed jobs (runs periodically)
async function cleanupOldJobs() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    // Delete completed jobs older than 7 days
    const result = await Job.deleteMany({
      status: 'completed',
      processedAt: { $lt: sevenDaysAgo }
    });
    
    if (result.deletedCount > 0) {
      console.log(`🧹 Cleaned up ${result.deletedCount} old completed job(s)`);
    }
    
    // Also delete very old failed jobs (older than 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const failedResult = await Job.deleteMany({
      status: 'failed',
      createdAt: { $lt: thirtyDaysAgo }
    });
    
    if (failedResult.deletedCount > 0) {
      console.log(`🧹 Cleaned up ${failedResult.deletedCount} old failed job(s)`);
    }
  } catch (err) {
    console.error("Cleanup error:", err.message);
  }
}

async function startWorker() {
  console.log("\n=================================");
  console.log("  Receipt Processing Worker");
  console.log("=================================");
  console.log(`Poll interval: ${POLL_INTERVAL}ms`);
  console.log(`Max concurrent: ${CONCURRENT_JOBS}`);
  console.log(`Max attempts: ${MAX_ATTEMPTS}`);
  console.log("=================================\n");

  await connectDB();

  // Start polling for jobs
  setInterval(pollJobs, POLL_INTERVAL);
  
  // Run job polling once immediately
  pollJobs();
  
  // Run cleanup every 6 hours
  setInterval(cleanupOldJobs, 6 * 60 * 60 * 1000);
  
  // Run cleanup once on startup
  cleanupOldJobs();

  console.log("✓ Worker started. Listening for jobs...\n");
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log("\n\nShutting down worker...");
  await mongoose.connection.close();
  console.log("✓ MongoDB connection closed");
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log("\n\nShutting down worker...");
  await mongoose.connection.close();
  console.log("✓ MongoDB connection closed");
  process.exit(0);
});

// Export functions for use as a module
module.exports = {
  startWorker,
  pollJobs,
  cleanupOldJobs
};

// Only start worker if run directly (not imported as module)
if (require.main === module) {
  startWorker().catch(err => {
    console.error("Worker startup error:", err);
    process.exit(1);
  });
}
