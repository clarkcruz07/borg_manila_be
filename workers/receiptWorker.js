require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
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

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✓ Worker connected to MongoDB");
  } catch (err) {
    console.error("✗ MongoDB connection error:", err);
    process.exit(1);
  }
}

async function processJob(job) {
  console.log(`\n[${new Date().toISOString()}] Processing job ${job._id}...`);
  
  try {
    // Update status to processing with atomic operation to prevent duplicate processing
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

    // If no document was updated, another worker already grabbed it
    if (updateResult.modifiedCount === 0) {
      console.log(`  ⊘ Job ${job._id} already being processed by another worker`);
      return;
    }

    console.log(`  ✓ Job ${job._id} locked for processing`);

    // Verify file exists before processing
    if (!fs.existsSync(job.filePath)) {
      throw new Error(`Receipt file not found: ${job.filePath}`);
    }
    
    const fileSize = fs.statSync(job.filePath).size;
    console.log(`  → File confirmed: ${job.filePath} (${(fileSize / 1024).toFixed(0)}KB)`);

    let extracted;
    
    try {
      // Try Gemini Vision API first
      console.log("  → Analyzing with Vision API...");
      try {
        extracted = await analyzeReceiptImage(job.filePath);
        console.log("  → Vision API succeeded");
      } catch (visionError) {
        console.error("  → Vision API error:", visionError.message);
        
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

    // Upload to Cloudinary with date-based folder structure
    let cloudinaryUrl = null;
    let finalFilePath = job.filePath;
    
    if (USE_CLOUDINARY && fs.existsSync(job.filePath)) {
      try {
        console.log("  → Compressing image for Cloudinary...");
        
        // Compress image: resize to max 1920px width, convert to JPEG with 85% quality
        const compressedPath = path.join(path.dirname(job.filePath), `compressed_${Date.now()}.jpg`);
        
        await sharp(job.filePath)
          .resize({ width: 1920, withoutEnlargement: true }) // Don't enlarge small images
          .jpeg({ quality: 85 }) // 85% quality - good balance between size and clarity
          .toFile(compressedPath);
        
        const originalSize = fs.statSync(job.filePath).size;
        const compressedSize = fs.statSync(compressedPath).size;
        const savedPercent = Math.round((1 - compressedSize / originalSize) * 100);
        
        console.log(`  ✓ Compressed: ${(originalSize / 1024).toFixed(0)}KB → ${(compressedSize / 1024).toFixed(0)}KB (${savedPercent}% reduction)`);
        
        console.log("  → Uploading to Cloudinary with date-based folder...");
        
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
        
        // Upload compressed image
        const result = await cloudinary.uploader.upload(compressedPath, {
          folder: folderPath,
          resource_type: "image",
          public_id: `${Date.now()}_${job.originalName.replace(/\.[^/.]+$/, "")}`,
        });

        cloudinaryUrl = result.secure_url;
        finalFilePath = cloudinaryUrl;
        console.log(`  ✓ Uploaded to Cloudinary: ${cloudinaryUrl}`);

        // Delete both original and compressed local files
        if (fs.existsSync(job.filePath)) {
          fs.unlinkSync(job.filePath);
        }
        if (fs.existsSync(compressedPath)) {
          fs.unlinkSync(compressedPath);
        }
        console.log("  ✓ Local files cleaned up");
      } catch (cloudinaryError) {
        console.error("  ✗ Cloudinary upload failed:", cloudinaryError.message);
        // Continue with local file path
      }
    }

    // Update job with results
    console.log("  → Updating job status to completed...");
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

    console.log(`  ✓ Job ${job._id} completed successfully (${completeResult.modifiedCount} document updated)`);
    
  } catch (error) {
    console.error(`  ✗ Job ${job._id} failed:`, error);
    console.error(`  ✗ Error stack:`, error.stack);
    
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
        if (fs.existsSync(job.filePath)) {
          fs.unlinkSync(job.filePath);
        }
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
