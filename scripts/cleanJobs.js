require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const Job = require("../models/Job");

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/borg_manila";

async function cleanJobs() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✓ Connected to MongoDB");

    // Delete all failed jobs
    const failedResult = await Job.deleteMany({ status: 'failed' });
    console.log(`Deleted ${failedResult.deletedCount} failed jobs`);

    // Delete all old pending/processing jobs (older than 1 day)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const oldResult = await Job.deleteMany({
      status: { $in: ['pending', 'processing'] },
      createdAt: { $lt: oneDayAgo }
    });
    console.log(`Deleted ${oldResult.deletedCount} old pending/processing jobs`);

    // Show remaining jobs
    const remaining = await Job.countDocuments();
    console.log(`\nRemaining jobs: ${remaining}`);

    const byStatus = await Job.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    console.log("By status:", byStatus);

    await mongoose.connection.close();
    console.log("\n✓ Cleanup complete");
    process.exit(0);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}

cleanJobs();
