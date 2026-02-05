import { Connection } from "@solana/web3.js";

async function debugTransaction() {
  const signature =
    "55vXCK1oufU3MQqN3HUPpZMUq8MkTX1fsLthxQnovVVEkFBWbfTq4fL7YpoDmUrbunktS898GzL76Ayk3vmAgShF";
  const stakingAddr = "3nkkix8AJmmaQ7hcHWkkjNQTHTnK5BN61G1TxkEc9gdb";
  const minAmountSol = 0.0;
  const maxAmountSol = 0.019619286;

  const conn = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  );

  console.log("🔍 Fetching transaction...");
  const tx = await conn.getParsedTransaction(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    console.error("❌ Transaction not found");
    return;
  }

  console.log("✅ Transaction found");
  console.log(
    "📋 Number of instructions:",
    tx.transaction.message.instructions.length,
  );

  const instructions = tx.transaction.message.instructions;

  for (let i = 0; i < instructions.length; i++) {
    const ix = instructions[i];
    console.log(`\n  Instruction ${i}:`);
    console.log(`    program: ${ix.program}`);
    console.log(`    parsed type: ${ix.parsed?.type}`);

    if (ix.program === "system" && ix.parsed?.type === "transfer") {
      const info = ix.parsed.info;
      const lamports = info.lamports;
      const solAmount = lamports / 1e9;

      console.log(`    ✅ System transfer found!`);
      console.log(`      From: ${info.source}`);
      console.log(`      To: ${info.destination}`);
      console.log(
        `      Amount: ${solAmount.toFixed(9)} SOL (${lamports} lamports)`,
      );
      console.log(
        `      Expected range: ${minAmountSol.toFixed(9)} - ${maxAmountSol.toFixed(9)} SOL`,
      );

      console.log(`\n    🔍 Checking destination...`);
      console.log(`      info.destination: "${info.destination}"`);
      console.log(`      stakingAddr:      "${stakingAddr}"`);
      console.log(`      Match: ${info.destination === stakingAddr}`);

      if (info.destination === stakingAddr) {
        console.log(`    ✅ Destination matches!`);

        // FIXED: Use explicit undefined check to handle 0 as a valid value
        const min = minAmountSol !== undefined ? minAmountSol : maxAmountSol;
        const max = maxAmountSol !== undefined ? maxAmountSol : minAmountSol;

        console.log(`\n    🔍 Checking amount...`);
        console.log(`      solAmount: ${solAmount}`);
        console.log(`      min: ${min}`);
        console.log(`      max: ${max}`);
        console.log(`      solAmount >= min: ${solAmount >= min}`);
        console.log(`      solAmount <= max: ${solAmount <= max}`);
        console.log(`      In range: ${solAmount >= min && solAmount <= max}`);

        if (solAmount >= min && solAmount <= max) {
          console.log(`    ✅ VERIFICATION SHOULD PASS!`);
          return true;
        } else {
          console.log(`    ❌ Amount out of range`);
        }
      } else {
        console.log(`    ❌ Wrong destination`);
      }
    }
  }

  console.log("\n❌ No valid fee transfer found");
  return false;
}

debugTransaction()
  .then((result) => {
    console.log(`\n🎯 Final result: ${result}`);
    process.exit(result ? 0 : 1);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
