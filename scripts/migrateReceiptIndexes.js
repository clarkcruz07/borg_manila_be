require("dotenv").config();
const mongoose = require("mongoose");

async function run() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  await mongoose.connect(mongoUri, {
    serverApi: {
      version: "1",
      strict: true,
      deprecationErrors: true,
    },
  });

  const collection = mongoose.connection.collection("receipts");
  const indexes = await collection.indexes();
  const byName = new Map(indexes.map((idx) => [idx.name, idx]));

  const targetNames = ["userId_1_receiptKey_1", "userId_1_fileHash_1"];

  for (const name of targetNames) {
    if (byName.has(name)) {
      await collection.dropIndex(name);
      console.log(`Dropped index: ${name}`);
    } else {
      console.log(`Index not found (skip): ${name}`);
    }
  }

  await collection.createIndex(
    { userId: 1, receiptKey: 1 },
    {
      name: "userId_1_receiptKey_1",
      unique: true,
      partialFilterExpression: { receiptKey: { $exists: true, $type: "string" } },
    }
  );
  console.log("Created index: userId_1_receiptKey_1 (partial unique)");

  await collection.createIndex(
    { userId: 1, fileHash: 1 },
    {
      name: "userId_1_fileHash_1",
      unique: true,
      partialFilterExpression: { fileHash: { $exists: true, $type: "string" } },
    }
  );
  console.log("Created index: userId_1_fileHash_1 (partial unique)");

  await mongoose.connection.close();
  console.log("Receipt index migration complete.");
}

run().catch(async (err) => {
  console.error("Receipt index migration failed:", err.message);
  try {
    await mongoose.connection.close();
  } catch (_) {}
  process.exit(1);
});
