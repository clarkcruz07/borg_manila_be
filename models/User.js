const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: Number,
      enum: [1, 2, 3], // 1 = Manager, 2 = HR, 3 = Employee
      default: 3,
    },
    passwordChanged: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    passwordChangedAt: {
      type: Date,
      default: null,
    },
    createdAtFormatted: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Hash password before saving
userSchema.pre("save", async function () {
  // If password wasn't modified, do nothing
  if (!this.isModified("password")) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Format timestamp as MM/dd/yyyy when creating a new user
userSchema.pre("save", async function () {
  // Only set formatted timestamp if this is a new document and createdAtFormatted is not already set
  if (this.isNew && !this.createdAtFormatted) {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const year = now.getFullYear();
    this.createdAtFormatted = `${month}/${day}/${year}`;
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Register model name "User" so refs like ref: "User" work correctly.
// Under the hood MongoDB collection will still be "users".
module.exports = mongoose.model("User", userSchema);
