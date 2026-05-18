import "@nomicfoundation/hardhat-ethers";

export default {
  solidity: {
    version: "0.8.20",
    settings: {
      evmVersion: "paris",
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    hardhat: {
      hardfork: "merge"
    }
  }
};
