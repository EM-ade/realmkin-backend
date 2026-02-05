import { Connection } from "@solana/web3.js";

// Test the _verifySolTransfer logic with different scenarios
function testVerificationLogic() {
  console.log("🧪 Testing fee verification logic with different scenarios\n");

  const scenarios = [
    {
      name: "STAKE: 100% tolerance with 0 min",
      minAmountSol: 0.0,
      maxAmountSol: 0.019619286,
      actualAmount: 0.009809642,
      shouldPass: true,
    },
    {
      name: "CLAIM: 100% tolerance (typical)",
      feeAmount: 0.02,
      tolerance: 1.0,
      actualAmount: 0.015,
      shouldPass: true,
    },
    {
      name: "UNSTAKE: 50% tolerance (typical)",
      feeAmount: 0.02,
      tolerance: 0.5,
      actualAmount: 0.015,
      shouldPass: true,
    },
    {
      name: "EDGE CASE: Very small fee with tolerance",
      feeAmount: 0.0001,
      tolerance: 0.5,
      actualAmount: 0.00008,
      shouldPass: true,
    },
    {
      name: "EDGE CASE: Zero fee (should this even happen?)",
      feeAmount: 0,
      tolerance: 1.0,
      actualAmount: 0,
      shouldPass: true,
    },
  ];

  scenarios.forEach((scenario, index) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Test ${index + 1}: ${scenario.name}`);
    console.log("=".repeat(60));

    let minAmountSol, maxAmountSol;

    if (scenario.feeAmount !== undefined) {
      // Calculate like claim/unstake do
      minAmountSol = scenario.feeAmount * (1 - scenario.tolerance);
      maxAmountSol = scenario.feeAmount * (1 + scenario.tolerance);
      console.log(`Fee amount: ${scenario.feeAmount} SOL`);
      console.log(`Tolerance: ${scenario.tolerance * 100}%`);
    } else {
      // Direct min/max like stake
      minAmountSol = scenario.minAmountSol;
      maxAmountSol = scenario.maxAmountSol;
    }

    console.log(`Min acceptable: ${minAmountSol.toFixed(9)} SOL`);
    console.log(`Max acceptable: ${maxAmountSol.toFixed(9)} SOL`);
    console.log(`Actual amount: ${scenario.actualAmount.toFixed(9)} SOL`);

    // OLD BUGGY LOGIC (for comparison)
    const oldMin = minAmountSol || maxAmountSol;
    const oldMax = maxAmountSol || minAmountSol;
    const oldResult =
      scenario.actualAmount >= oldMin && scenario.actualAmount <= oldMax;

    // NEW FIXED LOGIC
    const newMin = minAmountSol !== undefined ? minAmountSol : maxAmountSol;
    const newMax = maxAmountSol !== undefined ? maxAmountSol : minAmountSol;
    const newResult =
      scenario.actualAmount >= newMin && scenario.actualAmount <= newMax;

    console.log(`\n📊 OLD LOGIC (buggy):`);
    console.log(`  min = ${oldMin.toFixed(9)}, max = ${oldMax.toFixed(9)}`);
    console.log(`  Result: ${oldResult ? "✅ PASS" : "❌ FAIL"}`);

    console.log(`\n📊 NEW LOGIC (fixed):`);
    console.log(`  min = ${newMin.toFixed(9)}, max = ${newMax.toFixed(9)}`);
    console.log(`  Result: ${newResult ? "✅ PASS" : "❌ FAIL"}`);

    const expectedResult = scenario.shouldPass ? "✅ PASS" : "❌ FAIL";
    console.log(`\n🎯 Expected: ${expectedResult}`);

    if (newResult === scenario.shouldPass) {
      console.log("✅ TEST PASSED - New logic works correctly!");
    } else {
      console.log("❌ TEST FAILED - New logic has issues!");
    }

    if (oldResult !== newResult) {
      console.log(
        "⚠️  BEHAVIOR CHANGED - Old logic would have given different result",
      );
    }
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log("🎉 All tests completed!");
  console.log("=".repeat(60));
}

testVerificationLogic();
