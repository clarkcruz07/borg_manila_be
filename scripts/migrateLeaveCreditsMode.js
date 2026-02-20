// migrateLeaveCreditsMode.js
// Script to set leaveCreditsMode to 'manual' for all existing employees

const mongoose = require('mongoose');
const Employee = require('../models/Employee');
require('dotenv').config();

async function migrate() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI environment variable is not set');
    }
    await mongoose.connect(mongoUri);
    const result = await Employee.updateMany(
      { leaveCreditsMode: { $exists: false } },
      { $set: { leaveCreditsMode: 'manual' } }
    );
    console.log(`Updated ${result.nModified || result.modifiedCount} employees to leaveCreditsMode: 'manual'`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
