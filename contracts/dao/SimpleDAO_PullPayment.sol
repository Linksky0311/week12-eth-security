// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// FIX 3: Pull-over-Push payment
// withdraw() never pushes ETH — it only records a pending credit.
// The user must separately call claimPayment() to collect funds.
// Because no ETH is pushed during withdraw(), the attacker's receive() is never triggered.
contract SimpleDAO_PullPayment {
    mapping(address => uint256) public balances;
    mapping(address => uint256) public pendingPayments;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    // Records pending credit — does NOT send ETH, so no reentrancy hook
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance");

        balances[msg.sender] = 0;
        pendingPayments[msg.sender] += amount;
    }

    // Separate step: user pulls their own ETH
    function claimPayment() external {
        uint256 payment = pendingPayments[msg.sender];
        require(payment > 0, "No pending payment");

        pendingPayments[msg.sender] = 0;

        (bool ok, ) = msg.sender.call{value: payment}("");
        require(ok, "Transfer failed");
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
