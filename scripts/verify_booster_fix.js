import BoosterService from "../services/boosterService.js";

async function verifyFix() {
  const service = new BoosterService();
  const mintToVerify = "HmUpTxhKjYcPCwyCF65FyCRCyKP2WzUkrCrGFVDtT8YW"; // RMK #150

  console.log("🔍 Verifying booster configuration for:", mintToVerify);

  let found = false;
  for (const [key, category] of Object.entries(service.NFT_CATEGORIES)) {
    if (category.mints.includes(mintToVerify)) {
      console.log(`✅ MATCH FOUND in category: ${category.name} (${key})`);
      console.log(`   Multiplier: ${category.multiplier}x`);
      found = true;
      break;
    }
  }

  if (!found) {
    console.error("❌ MINT NOT FOUND in any category!");
  } else {
    console.log("✅ Verification SUCCESS: Typo fixed.");
  }
}

verifyFix();
