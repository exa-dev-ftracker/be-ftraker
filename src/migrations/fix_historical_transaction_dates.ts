import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const mongoUri =
  process.env.MONGO_DB_URL ||
  process.env.MONGO_URI ||
  process.env.MONGODB_URL ||
  process.argv[2];

if (!mongoUri) {
  console.error("❌ Error: MongoDB connection URI not provided.");
  console.error("Usage: npm run migrate:dates OR tsx src/migrations/fix_historical_transaction_dates.ts <mongoUri>");
  process.exit(1);
}

const CORRUPTED_PREFIX = "2026-09-28T23:32:05";

async function runMigration() {
  console.log("🚀 Starting database migration: fix_historical_transaction_dates...");
  console.log(`Connecting to MongoDB...`);

  await mongoose.connect(mongoUri as string);
  console.log("✅ Connected to MongoDB.");

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("Failed to get database handle");
  }

  const transactionsCollection = db.collection("transactions");

  // Query documents where date contains the corrupted timestamp or matches the exact second
  const corruptedStart = new Date("2026-09-28T23:32:05.000Z");
  const corruptedEnd = new Date("2026-09-28T23:32:05.999Z");

  const query = {
    $and: [
      {
        $or: [
          { date: { $gte: corruptedStart, $lte: corruptedEnd } },
          {
            $expr: {
              $regexMatch: {
                input: { $toString: "$date" },
                regex: CORRUPTED_PREFIX,
              },
            },
          },
        ],
      },
      { createdAt: { $exists: true, $ne: null } },
    ],
  };

  const count = await transactionsCollection.countDocuments(query);
  console.log(`📊 Found ${count} corrupted transaction document(s) matching ${CORRUPTED_PREFIX}.`);

  if (count === 0) {
    console.log("🎉 No corrupted transactions found. Database is already clean!");
    await mongoose.disconnect();
    process.exit(0);
  }

  // Update using aggregation pipeline to atomically copy createdAt to date
  console.log("⏳ Updating documents: setting date = createdAt...");
  const updateResult = await transactionsCollection.updateMany(
    query,
    [
      {
        $set: {
          date: "$createdAt",
          updatedAt: new Date(),
        },
      },
    ]
  );

  console.log(`✅ Migration complete!`);
  console.log(`Matched: ${updateResult.matchedCount}, Modified: ${updateResult.modifiedCount}`);

  await mongoose.disconnect();
  console.log("🔌 Disconnected from MongoDB.");
  process.exit(0);
}

runMigration().catch(async (error) => {
  console.error("❌ Migration failed with error:", error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
