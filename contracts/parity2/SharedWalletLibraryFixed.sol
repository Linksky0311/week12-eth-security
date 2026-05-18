// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// FIX: Two protections added.
//
// 1. Direct-call guard using an immutable:
//    _self is set to address(this) at deploy time and baked into the bytecode.
//    When the library code runs via delegatecall from a proxy, address(this) is
//    the proxy's address, which differs from _self (the library address).
//    When someone calls the library directly, address(this) == _self → revert.
//
// 2. Re-init guard:
//    initWallet() checks owner == address(0) so a proxy can only be initialized once.
//
// 3. No killLibrary / selfdestruct function — the attack surface is removed entirely.
contract SharedWalletLibraryFixed {
    address public owner; // slot 0

    // Immutables live in bytecode, not storage — no proxy storage collision
    address private immutable _self;

    constructor() {
        _self = address(this); // library's own address, fixed at deploy
    }

    function initWallet(address _owner) public {
        // Reject calls made directly to the library contract itself
        require(address(this) != _self, "Cannot init library directly");
        // Reject re-initialization of an already-initialized proxy
        require(owner == address(0), "Already initialized");
        owner = _owner;
    }

    function execute(address to, uint256 value, bytes calldata data) external {
        require(msg.sender == owner, "Owner only");
        (bool ok, ) = to.call{value: value}(data);
        require(ok, "Execute failed");
    }

    // No killLibrary — selfdestruct path intentionally removed
}
