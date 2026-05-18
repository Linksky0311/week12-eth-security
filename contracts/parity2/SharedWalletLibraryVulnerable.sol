// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// !! LOCAL TEACHING ONLY - DO NOT DEPLOY TO ANY REAL NETWORK !!
// Parity Wallet Hack #2 (2017): Library Self-Destruct → Frozen Funds
//
// Two vulnerabilities in combination:
//   1. initWallet() has no "direct call to library" protection.
//      Anyone can call it on the library itself (not via proxy delegatecall)
//      to become the library's own owner.
//   2. killLibrary() is public and guarded only by the owner check.
//      After step 1, the attacker IS the owner, so they can call selfdestruct.
//
// Result: every proxy wallet that pointed to this library can no longer execute
//         anything, because their delegatecall target has no code.
//         The ETH inside each wallet is permanently FROZEN (not stolen).
contract SharedWalletLibraryVulnerable {
    address public owner; // slot 0

    // VULNERABLE: no check for direct-to-library calls
    function initWallet(address _owner) public {
        owner = _owner;
    }

    function execute(address to, uint256 value, bytes calldata data) external {
        require(msg.sender == owner, "Owner only");
        (bool ok, ) = to.call{value: value}(data);
        require(ok, "Execute failed");
    }

    // VULNERABLE: unprotected selfdestruct path — owner (attacker after step 1) can call this
    function killLibrary() external {
        require(msg.sender == owner, "Owner only");
        selfdestruct(payable(owner)); // destroys this contract's code permanently
    }
}
