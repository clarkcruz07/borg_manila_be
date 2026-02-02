const admin = require("firebase-admin");
const path = require("path");

// Initialize Firebase Admin SDK
// Download your Firebase service account key and place it in backend/config/serviceAccountKey.json
const serviceAccountKeyPath = path.join(__dirname, "serviceAccountKey.json");

// Check if service account key exists
const fs = require("fs");
if (!fs.existsSync(serviceAccountKeyPath)) {
  console.warn(
    "⚠️  serviceAccountKey.json not found. Please download it from Firebase Console and place it in backend/config/"
  );
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountKeyPath),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };
