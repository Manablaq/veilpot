import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import { HardhatUserConfig, vars } from "hardhat/config";

// Hardhat variables are stored outside this repository. The Sepolia network is
// intentionally absent until all required non-secret configuration references
// exist, preventing an accidental broadcast through a placeholder endpoint.
const sepoliaRpcUrl = vars.get("SEPOLIA_RPC_URL", "");
const deployerPrivateKey = vars.get("DEPLOYER_PRIVATE_KEY", "");
const unauthorizedPrivateKey = vars.get("UNAUTHORIZED_PRIVATE_KEY", "");
const sepolia =
  sepoliaRpcUrl.length > 0 && deployerPrivateKey.length > 0 && unauthorizedPrivateKey.length > 0
    ? {
        sepolia: {
          accounts: [deployerPrivateKey],
          chainId: 11_155_111,
          url: sepoliaRpcUrl,
        },
      }
    : {};

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      evmVersion: "cancun",
      // The plugin injects a chain-specific ZamaConfig source for Sepolia.
      // Omitting Solidity's source-derived metadata hash keeps the deployed
      // runtime hash reproducible across otherwise identical compilation paths.
      metadata: { bytecodeHash: "none" },
      optimizer: { enabled: true, runs: 800 },
      viaIR: true,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: sepolia,
};

export default config;
