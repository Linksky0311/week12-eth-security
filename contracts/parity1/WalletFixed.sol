// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// FIX: Owner is set in the constructor and the initialized flag is true from birth.
// Re-initialization always reverts; non-owner execute always reverts.
contract WalletFixed {
    address public owner;
    bool private initialized;

    constructor(address _owner) {
        require(_owner != address(0), "Invalid owner");
        owner = _owner;
        initialized = true;
    }

    receive() external payable {}

    // Always rejects re-initialization — replaces the unprotected initWallet pattern
    function initWallet(address) external view {
        require(!initialized, "Already initialized");
    }

    function execute(address to, uint256 value, bytes calldata data) external {
        require(msg.sender == owner, "Owner only");
        (bool ok, ) = to.call{value: value}(data);
        require(ok, "Execute failed");
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
