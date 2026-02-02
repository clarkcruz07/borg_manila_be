require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { connectDB } = require("./config/mongodb");
const receiptRoutes = require("./routes/receipts");
const authRoutes = require("./routes/auth");
const employeeRoutes = require("./routes/employee");

const app = express();
app.use(cors());
app.use(express.json());

// Serve uploaded images statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Connect to MongoDB on server start
async function startServer() {
  try {
    await connectDB();
    
    app.use("/api/auth", authRoutes);
    app.use("/api/receipts", receiptRoutes);
    app.use("/api/employee", employeeRoutes);

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
