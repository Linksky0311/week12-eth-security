# delegatecall Storage Collision — Text Diagram

## 1. How delegatecall Works

```
  EOA (caller)
      │
      │  call initWallet(attacker)
      ▼
┌──────────────────────────────────┐
│  Proxy Contract (WalletVulnerable)│
│                                  │
│  fallback() {                    │
│    library.delegatecall(msg.data)│─────────────────┐
│  }                               │                 │
│                                  │  CODE from here │
│  Storage:                        │◀────────────────┘
│  ┌─────────────────────────────┐ │  (but storage stays
│  │ slot 0: owner  = 0x???      │ │   in the PROXY)
│  │ slot 1: library = 0xLIB     │ │
│  └─────────────────────────────┘ │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│  Library Contract                │
│  (WalletLibraryVulnerable)       │
│                                  │
│  function initWallet(addr) {     │  ← CODE runs here
│    owner = addr;  // slot 0      │    but STORAGE written
│  }                               │    to proxy's slot 0
└──────────────────────────────────┘
```

**Key principle**: `delegatecall` borrows the library's **code** but uses the **caller's (proxy's) storage**.

---

## 2. Storage Slot Mapping

```
Proxy storage layout:          Library storage layout:
┌─────────────────────┐        ┌─────────────────────┐
│ slot 0: owner       │ ◀──── │ slot 0: owner       │ (same slot)
│ slot 1: library     │        └─────────────────────┘
└─────────────────────┘
```

When `initWallet(_owner)` runs via delegatecall:
- The Solidity compiler translates `owner = _owner` → `SSTORE(0, _owner)`
- `SSTORE` writes to **slot 0** of the **proxy's** storage
- `proxy.owner` is now `_owner`

---

## 3. Parity Hack #1 — Unauthorized Initialization

```
  Attacker EOA
      │
      │  sendTransaction(to=wallet2, data=initWallet(attacker))
      ▼
┌─────────────────────────────────────────┐
│  WalletVulnerable (wallet2)              │
│                                         │
│  BEFORE attack:                         │
│    slot 0 (owner) = 0x000...000  ← zero │
│    slot 1 (library) = 0xLIB             │
│                                         │
│  fallback() → library.delegatecall(...)  │
└─────────────────────────────────────────┘
             │
             │  delegatecall
             ▼
┌─────────────────────────────────────────┐
│  WalletLibraryVulnerable (library)       │
│                                         │
│  initWallet(attacker) {                 │
│    owner = attacker;  // SSTORE(0, ...)  │
│  }                                      │
└─────────────────────────────────────────┘
             │
             │  writes to proxy's slot 0
             ▼
┌─────────────────────────────────────────┐
│  WalletVulnerable (wallet2)              │
│                                         │
│  AFTER attack:                          │
│    slot 0 (owner) = 0xATTACKER  ← hijacked!
│    slot 1 (library) = 0xLIB             │
└─────────────────────────────────────────┘
```

**Root cause**: `initWallet()` has no access control and no "already initialized" check.

---

## 4. Parity Hack #2 — Library Self-Destruct

```
  Attacker EOA
      │
      │  Step 1: library.initWallet(attacker)   ← DIRECT call (not via proxy)
      ▼
┌─────────────────────────────────────────┐
│  SharedWalletLibraryVulnerable (library) │
│                                         │
│  library's own storage:                 │
│    slot 0 (owner) = 0xATTACKER  ← set   │
└─────────────────────────────────────────┘
      │
      │  Step 2: library.killLibrary()          ← msg.sender == owner (attacker) ✓
      ▼
┌─────────────────────────────────────────┐
│  SharedWalletLibraryVulnerable           │
│                                         │
│  selfdestruct(payable(owner))           │
│                                         │
│  CODE = 0x00  ← permanently gone        │
└─────────────────────────────────────────┘

  ┌──────────┐   ┌──────────┐   ┌──────────┐
  │ Wallet1  │   │ Wallet2  │   │ Wallet3  │
  │ 5 ETH    │   │ 5 ETH    │   │ 5 ETH    │
  │ FROZEN   │   │ FROZEN   │   │ FROZEN   │
  └──────────┘   └──────────┘   └──────────┘
       │               │               │
       └───────────────┴───────────────┘
                       │
              fallback → delegatecall
                       │
              library code = 0x00 → REVERT
```

**Result**: ETH is NOT stolen. Wallets still hold their funds.
But all operations that required delegatecall to the library **permanently fail**.
The funds are **frozen** — inaccessible forever.

---

## 5. Fix: `immutable _self` Guard (SharedWalletLibraryFixed)

```
Deploy time:
  _self = address(library)  ← baked into bytecode, not storage

Direct call to library:
  address(this) == _self  → REVERT "Cannot init library directly"

delegatecall from proxy:
  address(this) == proxy address ≠ _self  → allowed
  (proxy's owner slot is updated correctly)
```

This distinguishes "running in proxy context" from "running in library context"
without any storage overhead in the proxy.
