#!/usr/bin/env node

/**
 * Clear Revenue Distribution Allocations Directly via Firestore
 * 
 * This deletes allocation records directly from Firestore to allow re-running distribution.
 */

import "dotenv/config";
import admin from "firebase-admin";

// Initialize Firebase Admin
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} else {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT_JSON not found in .env");
  process.exit(1);
}

const db = admin.firestore();

// Get distribution ID from command line or use current month
const args = process.argv.slice(2);
const distributionId = args[0] || `revenue_dist_${new Date().getFullYear()}_${String(new Date().getMonth() + 1).padStart(2, '0')}`;

console.log("🗑️  Clear Revenue Distribution Allocations");
console.log("=" .repeat(80));
console.log(`Distribution ID: ${distributionId}`);
console.log("=" .repeat(80));
console.log("\n⚠️  WARNING: This will delete allocation records from Firestore!");
console.log("⚠️  This allows you to re-run the distribution for this month.");
console.log("\nPress Ctrl+C to cancel, or wait 3 seconds to continue...\n");

await new Promise(resolve => setTimeout(resolve, 3000));

async function clearDistribution() {
  try {
    console.log("🔍 Searching for allocation records...");
    
    const allocationsSnapshot = await db.collection('revenueDistributionAllocations')
      .where('distributionId', '==', distributionId)
      .get();
    
    if (allocationsSnapshot.empty) {
      console.log("✅ No allocations found for this distribution");
      console.log("   You can run the distribution script now.");
      process.exit(0);
    }
    
    console.log(`📊 Found ${allocationsSnapshot.size} allocation records`);
    console.log("🗑️  Deleting...\n");
    
    // Delete in batches
    const batchSize = 500;
    let deletedCount = 0;
    
    for (let i = 0; i < allocationsSnapshot.docs.length; i += batchSize) {
      const batch = db.batch();
      const chunk = allocationsSnapshot.docs.slice(i, i + batchSize);
      
      chunk.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      
      deletedCount += chunk.length;
      console.log(`   Deleted ${deletedCount} / ${allocationsSnapshot.size}...`);
    }
    
    console.log("\n" + "=".repeat(80));
    console.log("✅ ALLOCATIONS CLEARED SUCCESSFULLY");
    console.log("=".repeat(80));
    console.log(`Distribution ID: ${distributionId}`);
    console.log(`Records Deleted: ${deletedCount}`);
    console.log("=".repeat(80));
    console.log("\n💡 You can now run the distribution script:");
    console.log("   node scripts/run-production-revenue-distribution.js");
    
    process.exit(0);
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    console.error(error);
    process.exit(1);
  }
}

clearDistribution();
