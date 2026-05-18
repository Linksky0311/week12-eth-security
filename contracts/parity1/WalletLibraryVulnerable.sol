// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// !! LOCAL TEACHING ONLY - DO NOT DEPLOY TO ANY REAL NETWORK !!
// Parity Wallet Hack #1 (2017): Unprotected initWallet via delegatecall
//
// Key vulnerability: initWallet() has NO access control.
// When a proxy calls this via delegatecall, the library code runs
// inside the proxy's storage context — so it overwrites the proxy's owner slot.
contract WalletLibraryVulnerable {
    address public owner; // storage slot 0

    // VULNERABLE: anyone can call this to become owner of any proxy that hasn't been initialized
    function initWallet(address _owner) public {
        owner = _owner;
    }

    function execute(address to, uint256 value, bytes calldata data) external {
        require(msg.sender == owner, "Owner only");
        (bool ok, ) = to.call{value: value}(data);
        require(ok, "Execute failed");
    }
}
