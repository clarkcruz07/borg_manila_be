require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { connectDB } = require("./config/mongodb");
const receiptRoutes = require("./routes/receipts");
const authRoutes = require("./routes/auth");
const employeeRoutes = require("./routes/employee");
const adminRoutes = require("./routes/admin");
const attendanceRoutes = require("./routes/attendance");
const leaveRoutes = require("./routes/leaves");
const assetRoutes = require("./routes/assets");
const sampleRoutes = require("./routes/sample");

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increase limit for base64 images
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve uploaded images statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Connect to MongoDB on server start
async function startServer() {
  try {
    await connectDB();
    
    app.use("/api/auth", authRoutes);
    app.use("/api/receipts", receiptRoutes);
    app.use("/api/employee", employeeRoutes);
    app.use("/api/admin", adminRoutes);
    app.use("/api/attendance", attendanceRoutes);
    app.use("/api/leaves", leaveRoutes);
    app.use("/api/assets", assetRoutes);
    app.use("/api/sample", sampleRoutes);

    const PORT = 5000;
    app.listen(PORT, () => {
      console.log(`Backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
