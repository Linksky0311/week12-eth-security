// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Proxy wallet that shares one library contract with other wallets.
// All function calls are forwarded via delegatecall, so the library's
// code runs in this wallet's storage context.
//
// Storage layout (must match library's layout):
//   slot 0 : address owner         ← set by library's initWallet via delegatecall
//   slot 1 : address libraryAddress
contract SharedWallet {
    address public owner;          // slot 0 — written by delegatecall
    address public libraryAddress; // slot 1

    constructor(address _library) {
        libraryAddress = _library;
    }

    receive() external payable {}

    fallback() external payable {
        // Fail loudly if the library has been destroyed
        require(libraryAddress.code.length > 0, "Library code not found");
        (bool ok, ) = libraryAddress.delegatecall(msg.data);
        require(ok, "Delegatecall failed");
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
