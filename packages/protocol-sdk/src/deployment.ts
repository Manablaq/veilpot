import type { Address, Hex } from "./types.js";

export interface VeilpotProductionDeployment {
  readonly network: "sepolia";
  readonly chainId: 11155111;
  readonly deploymentEvidenceCommit: string;
  readonly deploymentEvidenceSha256: string;
  readonly deploymentSourceCommit: string;
  readonly runtimeRecoveryCommit: string;
  readonly deployer: Address;
  readonly confidentialToken: Address;
  readonly wrappersRegistry: Address;
  readonly pool: Address;
  readonly adapter: Address;
  readonly reserve: Address;
  readonly transactions: {
    readonly pool: Hex;
    readonly adapter: Hex;
    readonly reserve: Hex;
  };
  readonly blocks: {
    readonly pool: 11609481;
    readonly adapter: 11609482;
    readonly reserve: 11609484;
  };
  readonly assetClassification: "OFFICIAL_ZAMA_TESTNET_MOCK_ASSET";
  readonly yieldProfile: "SIMULATED_YIELD_FOR_SEPOLIA_DEMO";
}

export const VEILPOT_SEPOLIA_DEPLOYMENT = {
  network: "sepolia",
  chainId: 11155111,
  deploymentEvidenceCommit: "4b18babce6690ffe57ae5a730edb51ab81bd93bc",
  deploymentEvidenceSha256: "ba6f9d5b35dc7373382b9e49bcb9e6ff4628d0cad106236a4bedd97b7ab64109",
  deploymentSourceCommit: "c0fb1a9dba5d384a1745c5e7c5f9f1348f4d89d3",
  runtimeRecoveryCommit: "d7b96c9391060b6f7b3b7bd4305f3cc71ddaa68e",
  deployer: "0x1f87Ae197af539253978d435aD45cCf28Fb95024",
  confidentialToken: "0x4E7B06D78965594eB5EF5414c357ca21E1554491",
  wrappersRegistry: "0x2f0750Bbb0A246059d80e94c454586a7F27a128e",
  pool: "0x3beB5C46b5982b0029a6fbC39A9313ee8D19eb6B",
  adapter: "0xe1FbD1fBe801c00f13aF44E1D4e3B4271aDF0f56",
  reserve: "0xf748bF23C9f1C020Dcf3eb96c955904FCD8b40b0",
  transactions: {
    pool: "0x14ba134d6b220e9f572ed78ae1e6063c938045e4bef542fdc5122eefe1b492c1",
    adapter: "0x51f872938b4929e1c918d3c8388f5408a4337cd750bbdd31313cc9899c73bf2d",
    reserve: "0x6f00e4c30a4c6725758eea86ad6e6d5e9bb137c043176b6c1afca5746ba29a27",
  },
  blocks: {
    pool: 11609481,
    adapter: 11609482,
    reserve: 11609484,
  },
  assetClassification: "OFFICIAL_ZAMA_TESTNET_MOCK_ASSET",
  yieldProfile: "SIMULATED_YIELD_FOR_SEPOLIA_DEMO",
} as const satisfies VeilpotProductionDeployment;

export const SUPPORTED_REGISTRATION_VERSION = 1n;

export const REGISTRATION_BOND_WEI = 1_000_000_000_000_000n;
