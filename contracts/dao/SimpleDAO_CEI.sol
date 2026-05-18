// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// FIX 1: Checks-Effects-Interactions pattern
// State (balance) is updated BEFORE the external call, so re-entry finds a zeroed balance.
contract SimpleDAO_CEI {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance");

        // EFFECT first — zero the balance before any external interaction
        balances[msg.sender] = 0;

        // INTERACTION last — safe because state is already updated
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
