import admin from "firebase-admin";
import { readFileSync } from "fs";

// Initialize Firebase Admin
const serviceAccount = JSON.parse(
  readFileSync("./firebase-service-account.json", "utf8"),
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Flag to control whether to actually execute merges (dry run vs real run)
const DRY_RUN = true; // Set to false to actually execute merges

async function mergeDuplicateWallets() {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`🔧 MERGING DUPLICATE WALLET ADDRESSES IN userRewards`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes will be made)" : "LIVE RUN (changes will be applied)"}`);
  console.log("=".repeat(80));

  try {
    // Fetch all userRewards documents
    console.log(`\n📊 Fetching all userRewards documents...`);
    const snapshot = await db.collection("userRewards").get();

    if (snapshot.empty) {
      console.log(`❌ No userRewards documents found!`);
      return;
    }

    console.log(`✅ Found ${snapshot.size} total userRewards documents`);

    // Group by wallet address
    const walletMap = new Map();

    snapshot.forEach((doc) => {
      const data = doc.data();
      const walletAddress = data.walletAddress;

      // Skip if no wallet address
      if (!walletAddress) {
        return;
      }

      // Normalize wallet address to lowercase
      const normalizedWallet = walletAddress.toLowerCase();

      if (!walletMap.has(normalizedWallet)) {
        walletMap.set(normalizedWallet, []);
      }

      walletMap.get(normalizedWallet).push({
        userId: doc.id,
        docRef: doc.ref,
        ...data,
        createdAt: data.createdAt?.toDate() || null,
        lastUpdate: data.lastUpdate?.toDate() || null,
      });
    });

    // Filter for duplicates (wallets with more than 1 user)
    const duplicates = Array.from(walletMap.entries()).filter(
      ([_, users]) => users.length > 1
    );

    if (duplicates.length === 0) {
      console.log(`\n✅ No duplicate wallet addresses found!`);
      console.log("=".repeat(80));
      return;
    }

    console.log(`\n⚠️  Found ${duplicates.length} wallet addresses with multiple users`);
    console.log("=".repeat(80));

    const mergeActions = [];
    let totalMergedMKIN = 0;
    let totalAccountsToDelete = 0;

    // Process each duplicate wallet
    for (const [walletAddress, users] of duplicates) {
      console.log(`\n📝 Processing wallet: ${users[0].walletAddress}`);
      console.log(`   Number of duplicate accounts: ${users.length}`);

      // Sort by createdAt (oldest first) - oldest account becomes primary
      users.sort((a, b) => {
        if (!a.createdAt && !b.createdAt) return 0;
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return a.createdAt - b.createdAt;
      });

      const primaryUser = users[0];
      const duplicateUsers = users.slice(1);

      console.log(`\n   ✅ PRIMARY ACCOUNT (will keep):`);
      console.log(`      User ID: ${primaryUser.userId}`);
      console.log(`      Created: ${primaryUser.createdAt || "N/A"}`);
      console.log(`      Total MKIN: ${primaryUser.totalRealmkin?.toLocaleString() || 0}`);
      console.log(`      Pending Rewards: ${primaryUser.pendingRewards || 0}`);
      console.log(`      Weekly Rate: ${primaryUser.weeklyRate || 0} MKIN/week`);

      // Calculate totals to merge
      let totalMKIN = primaryUser.totalRealmkin || 0;
      let totalPending = primaryUser.pendingRewards || 0;
      let maxWeeklyRate = primaryUser.weeklyRate || 0;
      let maxNFTCount = primaryUser.nftCount || 0;

      console.log(`\n   🗑️  DUPLICATE ACCOUNTS (will be merged and deleted):`);
      duplicateUsers.forEach((user, index) => {
        console.log(`\n      ${index + 1}. User ID: ${user.userId}`);
        console.log(`         Created: ${user.createdAt || "N/A"}`);
        console.log(`         Total MKIN: ${user.totalRealmkin?.toLocaleString() || 0}`);
        console.log(`         Pending Rewards: ${user.pendingRewards || 0}`);
        console.log(`         Weekly Rate: ${user.weeklyRate || 0} MKIN/week`);

        // Accumulate values
        totalMKIN += user.totalRealmkin || 0;
        totalPending += user.pendingRewards || 0;
        maxWeeklyRate = Math.max(maxWeeklyRate, user.weeklyRate || 0);
        maxNFTCount = Math.max(maxNFTCount, user.nftCount || 0);
      });

      console.log(`\n   📊 MERGED TOTALS:`);
      console.log(`      Total MKIN: ${totalMKIN.toLocaleString()}`);
      console.log(`      Total Pending: ${totalPending.toLocaleString()}`);
      console.log(`      Max Weekly Rate: ${maxWeeklyRate} MKIN/week`);
      console.log(`      Max NFT Count: ${maxNFTCount}`);

      mergeActions.push({
        walletAddress: users[0].walletAddress,
        primaryUserId: primaryUser.userId,
        primaryDocRef: primaryUser.docRef,
        duplicateUserIds: duplicateUsers.map(u => u.userId),
        duplicateDocRefs: duplicateUsers.map(u => u.docRef),
        mergedData: {
          totalRealmkin: totalMKIN,
          pendingRewards: totalPending,
          weeklyRate: maxWeeklyRate,
          nftCount: maxNFTCount,
          walletAddress: users[0].walletAddress,
          lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
        },
      });

      totalMergedMKIN += totalMKIN;
      totalAccountsToDelete += duplicateUsers.length;
    }

    // Execute merges
    console.log(`\n\n${"=".repeat(80)}`);
    console.log(`📊 MERGE SUMMARY:`);
    console.log(`   Total wallets to process: ${duplicates.length}`);
    console.log(`   Total accounts to delete: ${totalAccountsToDelete}`);
    console.log(`   Total MKIN in merged accounts: ${totalMergedMKIN.toLocaleString()}`);
    console.log("=".repeat(80));

    if (DRY_RUN) {
      console.log(`\n⚠️  DRY RUN MODE - No changes have been made`);
      console.log(`   Set DRY_RUN = false in the script to execute these merges`);
      console.log("=".repeat(80));
      return;
    }

    // Confirm execution
    console.log(`\n⚠️  ABOUT TO EXECUTE MERGES - THIS WILL:`);
    console.log(`   1. Update ${mergeActions.length} primary accounts with merged data`);
    console.log(`   2. Delete ${totalAccountsToDelete} duplicate accounts`);
    console.log(`\n   Press Ctrl+C to cancel, or wait 10 seconds to continue...`);
    
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log(`\n🚀 Starting merge operations...`);

    let successCount = 0;
    let errorCount = 0;

    for (const action of mergeActions) {
      try {
        console.log(`\n   Processing wallet: ${action.walletAddress}`);
        
        // Use batch for atomic operations
        const batch = db.batch();

        // Update primary account
        batch.update(action.primaryDocRef, action.mergedData);

        // Delete duplicate accounts
        action.duplicateDocRefs.forEach(docRef => {
          batch.delete(docRef);
        });

        // Commit batch
        await batch.commit();

        console.log(`   ✅ Successfully merged and deleted ${action.duplicateUserIds.length} duplicate(s)`);
        successCount++;

      } catch (error) {
        console.error(`   ❌ Error merging wallet ${action.walletAddress}:`, error.message);
        errorCount++;
      }
    }

    console.log(`\n${"=".repeat(80)}`);
    console.log(`✅ MERGE COMPLETE!`);
    console.log(`   Successful: ${successCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log("=".repeat(80));

  } catch (error) {
    console.error(`\n❌ ERROR during merge:`, error);
    console.error(`   Stack:`, error.stack);
  }
}

mergeDuplicateWallets().catch(console.error);
