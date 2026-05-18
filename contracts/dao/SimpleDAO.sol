// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// !! LOCAL TEACHING ONLY - DO NOT DEPLOY TO ANY REAL NETWORK !!
// Historic reentrancy vulnerability reproduction (2016 DAO Hack)
contract SimpleDAO {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    // VULNERABLE: external call happens BEFORE state update
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance");

        // BUG: ETH is sent first — attacker's receive() can re-enter before balance is zeroed
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        // unchecked reproduces pre-0.8 wraparound so the reentrancy exploit doesn't revert
        unchecked {
            balances[msg.sender] -= amount;
        }
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
