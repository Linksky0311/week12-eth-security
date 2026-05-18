# Week 12 — Historic Ethereum Smart Contract Hacks

> **LOCAL SIMULATION ONLY**
> All scripts run on a Hardhat in-memory network.
> No real network, no RPC URL, no private key, no wallet connection.

---

## Quick Start

```bash
npm install
npm test        # compile + all simulations
```

Individual runs:

```bash
npm run compile
npm run simulate:dao        # DAO reentrancy attack
npm run simulate:dao-fixes  # CEI / Guard / Pull-over-Push verification
npm run simulate:parity1    # Parity #1 unauthorized init + fix
npm run simulate:parity2    # Parity #2 library selfdestruct + fix
```

---

## Project Structure

```
week_12/
├── contracts/
│   ├── dao/
│   │   ├── SimpleDAO.sol              Vulnerable DAO (reentrancy)
│   │   ├── DAOAttacker.sol            Reentrancy exploit contract
│   │   ├── SimpleDAO_CEI.sol          Fix 1: Checks-Effects-Interactions
│   │   ├── SimpleDAO_Guard.sol        Fix 2: Reentrancy Guard (mutex)
│   │   └── SimpleDAO_PullPayment.sol  Fix 3: Pull-over-Push
│   ├── parity1/
│   │   ├── WalletLibraryVulnerable.sol  Shared library with unprotected initWallet
│   │   ├── WalletVulnerable.sol         Proxy wallet (delegatecall-based)
│   │   └── WalletFixed.sol              Fixed wallet (constructor initialization)
│   └── parity2/
│       ├── SharedWalletLibraryVulnerable.sol  Library with selfdestruct
│       ├── SharedWallet.sol                   Proxy wallet
│       └── SharedWalletLibraryFixed.sol       Fixed library (immutable guard)
├── scripts/
│   ├── lib.js                 Logging helpers
│   ├── 01_dao_attack.js       DAO attack simulation
│   ├── 02_dao_fixes.js        DAO fix verification
│   ├── 03_parity1_attack.js   Parity #1 simulation + fix
│   └── 04_parity2_freeze.js   Parity #2 simulation + fix
├── logs/                      Generated at runtime
├── diagrams/
│   └── delegatecall_storage_collision.md
├── hardhat.config.js
└── package.json
```

---

## Hack 1: DAO Hack (2016) — Reentrancy

### Vulnerability

`SimpleDAO.withdraw()` sends ETH **before** updating the caller's balance:

```
1. Check: amount = balances[msg.sender]  ✓
2. Interact: msg.sender.call{value: amount}("")  ← ETH sent HERE
3. Effect: balances[msg.sender] -= amount        ← balance updated AFTER
```

Because the balance isn't zeroed before the external call, the recipient's
`receive()` function can re-enter `withdraw()` and find the same non-zero balance,
draining the DAO repeatedly until it's empty.

`unchecked` is used to reproduce the pre-Solidity-0.8 behavior where integer
underflow doesn't revert (teaching-only; removed in all fix versions).

### Expected Log

```
DAO balance:               0.0000 ETH
Attacker contract balance: 11.0000 ETH
PASS: DAO balance = 0 ETH after attack
PASS: Attacker holds 11 ETH (10 victim + 1 seed)
```

### Fixes

| Version | Mechanism | Why it works |
|---------|-----------|--------------|
| CEI | `balances[msg.sender] = 0` before `call` | Re-entry finds zero balance → reverts |
| ReentrancyGuard | `_locked` mutex | Re-entry hits `require(!_locked)` → reverts |
| Pull-over-Push | `withdraw()` records `pendingPayments`, no ETH push | `receive()` never triggered |

---

## Hack 2: Parity Wallet Hack #1 (2017) — Unauthorized Initialization

### Vulnerability

`WalletLibraryVulnerable.initWallet()` has no access control.

The proxy forwards all calls via `delegatecall`, which runs the library's code
in the proxy's storage context. Storage slot 0 (`owner`) is shared between
library and proxy by layout design.

An uninitialized proxy (owner == address(0)) can have its owner slot overwritten
by anyone calling `initWallet(attacker)` through the proxy's fallback.

### Expected Log

```
PASS: Attacker is now owner of Wallet2
PASS: Attacker is now owner of Wallet3
PASS: Wallet2 drained to 0 ETH
PASS: Wallet3 drained to 0 ETH
PASS: WalletFixed: re-initialization rejected (already initialized)
PASS: WalletFixed: non-owner execute rejected (owner only)
```

### Fix

`WalletFixed` sets `owner` in its constructor and marks `initialized = true`.
`initWallet()` always reverts. No delegatecall needed for initialization.

---

## Hack 3: Parity Wallet Hack #2 (2017) — Library Self-Destruct

### Vulnerability (two steps)

1. `SharedWalletLibraryVulnerable.initWallet()` has no "direct call" guard.
   An attacker calls it **directly on the library** (not via proxy), making
   themselves the library's own `owner`.

2. `killLibrary()` calls `selfdestruct`. Since the attacker is now the library's
   owner, they pass the `require(msg.sender == owner)` check and destroy the code.

### Critical distinction

> **The ETH is NOT stolen.** Each proxy wallet still holds its funds.
> The library code is gone, so every proxy's `delegatecall` fails.
> Funds are **frozen** — permanently inaccessible.

### Expected Log

```
PASS: Library has code before attack
PASS: Library code = 0x (selfdestruct confirmed)
PASS: Wallet1: 5 ETH still present (frozen, not stolen)
PASS: Wallet2: 5 ETH still present (frozen, not stolen)
PASS: Wallet3: 5 ETH still present (frozen, not stolen)
PASS: Execute fails after library self-destruct
```

### Fix

`SharedWalletLibraryFixed` uses an `immutable _self` address set at deploy time.
`initWallet()` checks `address(this) != _self`:

- Direct call on library: `address(this) == _self` → reverts
- Via `delegatecall` from proxy: `address(this) == proxy ≠ _self` → allowed

No `killLibrary` function exists — the selfdestruct path is removed entirely.

---

## EVM Configuration

```js
// hardhat.config.js
solidity: { version: "0.8.20", settings: { evmVersion: "paris" } }
networks: { hardhat: { hardfork: "merge" } }
```

`hardfork: "merge"` uses pre-Cancun semantics where `SELFDESTRUCT` actually
removes contract code at end of transaction (EIP-6780 is NOT active).

---

## Further Reading

- [The DAO Hack Explained](https://www.coindesk.com/learn/2016/06/25/understanding-the-dao-attack/)
- [Parity Wallet Bug #1](https://blog.openzeppelin.com/on-the-parity-wallet-multisig-hack)
- [Parity Wallet Bug #2](https://blog.openzeppelin.com/parity-wallet-hack-reloaded)
- [CEI Pattern — Solidity Docs](https://docs.soliditylang.org/en/latest/security-considerations.html)
