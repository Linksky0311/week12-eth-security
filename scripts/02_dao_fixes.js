import hre from "hardhat";
const { ethers } = hre;
import { initLog, assert, eth } from "./lib.js";

async function main() {
  const { log, save } = initLog("dao_fixes.log");
  const [, victim, attacker, user] = await ethers.getSigners();

  log("=".repeat(60));
  log("  DAO FIXES — Reentrancy Prevention Verification");
  log("=".repeat(60));

  // Helper: deploy a fresh DAOAttacker pointed at a target DAO
  async function deployAttacker(daoAddr) {
    const DAOAttacker = await ethers.getContractFactory("DAOAttacker");
    const a = await DAOAttacker.connect(attacker).deploy(daoAddr);
    await a.waitForDeployment();
    return a;
  }

  // ─────────────────────────────────────────────────────────
  // FIX 1: Checks-Effects-Interactions (CEI)
  // ─────────────────────────────────────────────────────────
  log("\n" + "-".repeat(60));
  log("  FIX 1: Checks-Effects-Interactions (CEI)");
  log("-".repeat(60));

  const DAO_CEI = await (await ethers.getContractFactory("SimpleDAO_CEI")).deploy();
  await DAO_CEI.waitForDeployment();
  await DAO_CEI.connect(victim).deposit({ value: ethers.parseEther("10") });
  log(`  Deployed. Victim deposited 10 ETH.`);

  const att1 = await deployAttacker(DAO_CEI.target);
  let reverted1 = false;
  try {
    await att1.connect(attacker).attack({ value: ethers.parseEther("1") });
  } catch {
    reverted1 = true;
  }

  const bal1 = await ethers.provider.getBalance(DAO_CEI.target);
  log(`  Attack tx reverted: ${reverted1}`);
  log(`  DAO balance after attack attempt: ${eth(bal1)}`);
  log(assert(reverted1, "CEI: attack transaction reverted"));
  log(assert(bal1 === ethers.parseEther("10"), "CEI: victim's 10 ETH is safe"));

  log("\n  Why it works:");
  log("    balances[msg.sender] = 0  ← zeroed BEFORE the external call");
  log("    Re-entry hits require(amount > 0) → reverts entire tx");

  // ─────────────────────────────────────────────────────────
  // FIX 2: Reentrancy Guard
  // ─────────────────────────────────────────────────────────
  log("\n" + "-".repeat(60));
  log("  FIX 2: Reentrancy Guard (mutex)");
  log("-".repeat(60));

  const DAO_Guard = await (await ethers.getContractFactory("SimpleDAO_Guard")).deploy();
  await DAO_Guard.waitForDeployment();
  await DAO_Guard.connect(victim).deposit({ value: ethers.parseEther("10") });
  log(`  Deployed. Victim deposited 10 ETH.`);

  const att2 = await deployAttacker(DAO_Guard.target);
  let reverted2 = false;
  try {
    await att2.connect(attacker).attack({ value: ethers.parseEther("1") });
  } catch {
    reverted2 = true;
  }

  const bal2 = await ethers.provider.getBalance(DAO_Guard.target);
  log(`  Attack tx reverted: ${reverted2}`);
  log(`  DAO balance after attack attempt: ${eth(bal2)}`);
  log(assert(reverted2, "Guard: attack transaction reverted"));
  log(assert(bal2 === ethers.parseEther("10"), "Guard: victim's 10 ETH is safe"));

  log("\n  Why it works:");
  log("    _locked = true before external call");
  log("    Re-entry hits require(!_locked) → reverts entire tx");

  // ─────────────────────────────────────────────────────────
  // FIX 3: Pull-over-Push
  // ─────────────────────────────────────────────────────────
  log("\n" + "-".repeat(60));
  log("  FIX 3: Pull-over-Push payment");
  log("-".repeat(60));

  const DAO_Pull = await (await ethers.getContractFactory("SimpleDAO_PullPayment")).deploy();
  await DAO_Pull.waitForDeployment();
  await DAO_Pull.connect(victim).deposit({ value: ethers.parseEther("10") });
  log(`  Deployed. Victim deposited 10 ETH.`);

  // Attack tx will NOT revert — but no ETH is pushed so receive() never fires
  const att3 = await deployAttacker(DAO_Pull.target);
  let pullTxReverted = false;
  try {
    await att3.connect(attacker).attack({ value: ethers.parseEther("1") });
  } catch {
    pullTxReverted = true;
  }

  const daoBalPull = await ethers.provider.getBalance(DAO_Pull.target);
  const attackerBalPull = await ethers.provider.getBalance(att3.target);
  log(`  Attack tx reverted: ${pullTxReverted} (no revert needed — no ETH is pushed)`);
  log(`  DAO balance: ${eth(daoBalPull)}`);
  log(`  Attacker contract balance: ${eth(attackerBalPull)}`);
  log(assert(daoBalPull >= ethers.parseEther("10"), "Pull: victim's 10 ETH still in DAO"));
  log(assert(attackerBalPull === 0n, "Pull: no ETH pushed to attacker contract"));

  log("\n  Why it works:");
  log("    withdraw() records pendingPayments[msg.sender] += amount");
  log("    No ETH is sent → attacker.receive() is never triggered → no reentrancy");

  // Legitimate user can still claim
  log("\n  Legitimate user claim flow:");
  await DAO_Pull.connect(user).deposit({ value: ethers.parseEther("2") });
  await DAO_Pull.connect(user).withdraw();
  const pending = await DAO_Pull.pendingPayments(user.address);
  log(`  Pending after withdraw(): ${eth(pending)}`);
  log(assert(pending === ethers.parseEther("2"), "Pull: user has 2 ETH pending"));

  await DAO_Pull.connect(user).claimPayment();
  const pendingAfter = await DAO_Pull.pendingPayments(user.address);
  log(assert(pendingAfter === 0n, "Pull: user successfully claimed via claimPayment()"));
  log(`  Pending after claim: ${eth(pendingAfter)}`);

  log("\n" + "=".repeat(60));
  log("  ALL DAO FIX VERIFICATIONS PASSED");
  log("=".repeat(60));

  save();
}

main().catch((e) => { console.error(e); process.exit(1); });
