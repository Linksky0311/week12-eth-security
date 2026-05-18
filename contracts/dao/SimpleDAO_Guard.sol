// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// FIX 2: Reentrancy Guard
// A mutex (_locked) blocks any nested call to withdraw() while one is already executing.
contract SimpleDAO_Guard {
    mapping(address => uint256) public balances;
    bool private _locked;

    modifier nonReentrant() {
        require(!_locked, "Reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() external nonReentrant {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance");

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        balances[msg.sender] = 0;
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
