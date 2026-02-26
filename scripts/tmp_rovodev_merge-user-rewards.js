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

const isDryRun = process.env.DRY_RUN === "true";

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value instanceof admin.firestore.Timestamp) return value.toDate();
  return null;
};

const parseNumber = (value) => (typeof value === "number" ? value : 0);

const selectPrimaryDoc = (docs, withdrawalCounts) => {
  return docs
    .sort((a, b) => {
      const dataA = a.data();
      const dataB = b.data();
      const countA = withdrawalCounts.get(dataA.userId) || 0;
      const countB = withdrawalCounts.get(dataB.userId) || 0;
      if (countA !== countB) {
        return countB - countA;
      }
      const claimedA = parseNumber(dataA.totalClaimed);
      const claimedB = parseNumber(dataB.totalClaimed);
      if (claimedA !== claimedB) {
        return claimedB - claimedA;
      }
      return a.id.localeCompare(b.id);
    })
    .shift();
};

const getWithdrawalCounts = async (wallet) => {
  const snapshot = await db
    .collection("usedWithdrawalFees")
    .where("walletAddress", "==", wallet)
    .get();

  const counts = new Map();
  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    if (!data.userId) return;
    counts.set(data.userId, (counts.get(data.userId) || 0) + 1);
  });

  return counts;
};

async function mergeDuplicates() {
  const snapshot = await db.collection("userRewards").get();
  const byWallet = new Map();

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const wallet = (data.walletAddress || "").trim();
    if (!wallet) return;
    if (!byWallet.has(wallet)) {
      byWallet.set(wallet, []);
    }
    byWallet.get(wallet).push(doc);
  });

  let mergedCount = 0;
  let duplicateCount = 0;
  const now = new Date();

  for (const [wallet, docs] of byWallet.entries()) {
    if (docs.length < 2) continue;

    duplicateCount += docs.length - 1;
    const withdrawalCounts = await getWithdrawalCounts(wallet);
    const primaryDoc = selectPrimaryDoc(docs, withdrawalCounts);
    const primaryData = primaryDoc.data();
    const claimedPrimary = parseNumber(primaryData.totalClaimed);
    const sortedCandidates = docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          userId: data.userId,
          claimed: parseNumber(data.totalClaimed),
          withdrawals: withdrawalCounts.get(data.userId) || 0,
        };
      })
      .sort((a, b) => {
        if (a.withdrawals !== b.withdrawals) {
          return b.withdrawals - a.withdrawals;
        }
        if (a.claimed !== b.claimed) {
          return b.claimed - a.claimed;
        }
        return a.id.localeCompare(b.id);
      });

    console.log(
      `🧭 Wallet ${wallet}: selecting primary ${primaryDoc.id} (withdrawals=${withdrawalCounts.get(primaryData.userId) || 0}, totalClaimed=${claimedPrimary}). Candidates: ${sortedCandidates
        .map(
          (entry) => `${entry.id}:${entry.userId}:${entry.withdrawals}:${entry.claimed}`,
        )
        .join(", ")}`,
    );

    console.log(
      `📊 Withdrawal counts: ${[...withdrawalCounts.entries()]
        .map(([userId, count]) => `${userId}:${count}`)
        .join(", ") || "none"}`,
    );

    console.log(`📄 Duplicate details for wallet ${wallet}`);
    docs.forEach((doc) => {
      const data = doc.data();
      console.log(
        JSON.stringify(
          {
            id: doc.id,
            walletAddress: data.walletAddress,
            totalClaimed: data.totalClaimed,
            totalEarned: data.totalEarned,
            totalRealmkin: data.totalRealmkin,
            pendingRewards: data.pendingRewards,
            weeklyRate: data.weeklyRate,
            totalNFTs: data.totalNFTs,
            lastCalculated: data.lastCalculated?.toDate?.() ?? data.lastCalculated,
            lastClaimed: data.lastClaimed?.toDate?.() ?? data.lastClaimed,
            createdAt: data.createdAt?.toDate?.() ?? data.createdAt,
            updatedAt: data.updatedAt?.toDate?.() ?? data.updatedAt,
          },
          null,
          2,
        ),
      );
    });

    for (const duplicateDoc of docs) {
      if (duplicateDoc.id === primaryDoc.id) continue;

      if (isDryRun) {
        console.log(
          `🧪 Dry run: would delete ${duplicateDoc.id} for wallet ${wallet}`,
        );
      } else {
        await db.runTransaction(async (transaction) => {
          const duplicateRef = duplicateDoc.ref;
          const duplicateSnap = await transaction.get(duplicateRef);
          if (!duplicateSnap.exists) return;

          transaction.delete(duplicateRef);
        });
      }

      mergedCount += 1;
    }

    console.log(
      `${isDryRun ? "🧪 Dry run:" : "✅"} Merged wallet ${wallet} into ${primaryDoc.id}`,
    );
  }

  console.log(
    `🎯 ${isDryRun ? "Dry run complete" : "Done"}. ${mergedCount} duplicate docs ${isDryRun ? "would be" : ""} merged (${duplicateCount} duplicates found).`,
  );
}

mergeDuplicates().catch((error) => {
  console.error("❌ Merge failed:", error);
  process.exit(1);
});
