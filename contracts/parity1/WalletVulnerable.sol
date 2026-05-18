// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// !! LOCAL TEACHING ONLY - DO NOT DEPLOY TO ANY REAL NETWORK !!
// Parity proxy wallet: delegates all logic to a shared library via delegatecall.
//
// Storage layout (must match library's layout):
//   slot 0 : address owner      ← set by library's initWallet via delegatecall
//   slot 1 : address library
//
// If initWallet is never called by the real owner, slot 0 stays address(0)
// and anyone can call initWallet through the fallback to claim ownership.
contract WalletVulnerable {
    address public owner;      // slot 0  — written by delegatecall to library
    address public walletLib;  // slot 1

    constructor(address _library) {
        walletLib = _library;
        // owner intentionally NOT set here to reproduce the original vulnerability
    }

    receive() external payable {}

    fallback() external payable {
        (bool ok, ) = walletLib.delegatecall(msg.data);
        require(ok, "Delegatecall failed");
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
