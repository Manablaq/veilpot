import type { Address, Hex } from "./types.js";

export interface VeilpotProductionDeployment {
  readonly network: "sepolia";
  readonly chainId: 11155111;
  readonly deploymentEvidenceCommit: string;
  readonly deploymentEvidenceSha256: string;
  readonly runtimeEvidenceCommit: string;
  readonly runtimeEvidenceSha256: string;
  readonly runtimeJournalSha256: string;
  readonly deploymentSourceCommit: string;
  readonly deployer: Address;
  readonly confidentialToken: Address;
  readonly underlyingToken: Address;
  readonly wrappersRegistry: Address;
  readonly pool: Address;
  readonly vault: Address;
  readonly adapter: Address;
  readonly reserve: Address;
  readonly transactions: {
    readonly pool: Hex;
    readonly vault: Hex;
    readonly adapter: Hex;
    readonly reserve: Hex;
  };
  readonly blocks: {
    readonly pool: 11614331;
    readonly vault: 11614332;
    readonly adapter: 11614333;
    readonly reserve: 11614334;
  };
  readonly assetClassification: "OFFICIAL_ZAMA_TESTNET_MOCK_ASSET";
  readonly yieldProfile: "SIMULATED_YIELD_FOR_SEPOLIA_DEMO";
}

export const VEILPOT_SEPOLIA_V1_DEPLOYMENT = {
  network: "sepolia",
  chainId: 11155111,
  deploymentEvidenceCommit: "dd3b53311b98a8af03f154a31cade7e4b354cf45",
  deploymentEvidenceSha256: "939127735c3ea54763992b8238b09a37a4474d66f6774c0eab5f619328ffcd98",
  runtimeEvidenceCommit: "fb417f62db1ba7936b80c7cfb68b0a42c2fd4972",
  runtimeEvidenceSha256: "147c83636f21ac13b8e26174cce1abe1a02d18f496d42d00aa53a7e8d0b8729a",
  runtimeJournalSha256: "cb9fa6873acbfb04c58be61c643f2a9413aae75aea6afa3143298eac98a5c3ff",
  deploymentSourceCommit: "ad437e0edf1f4809a53d045879da28da87c10b78",
  deployer: "0x1f87Ae197af539253978d435aD45cCf28Fb95024",
  confidentialToken: "0x4E7B06D78965594eB5EF5414c357ca21E1554491",
  underlyingToken: "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0",
  wrappersRegistry: "0x2f0750Bbb0A246059d80e94c454586a7F27a128e",
  pool: "0x2029D8b7AE6Abe7dAa0C2A71E960839171a34601",
  vault: "0x7dF64925Af938a0535F30dE9cFBf97BB3ab30487",
  adapter: "0xEa9868e982b98B57C52B95853EdE2552dAD74b64",
  reserve: "0xbEe24d1060d94d435272550fAa5616faD59Ad1a1",
  transactions: {
    pool: "0xe4eebc4ddede885450523b93b289e85f240dfefe0b1781d7b53f387437ad4ea0",
    vault: "0x5f96f76ced42c123cbcd0fb2090e3bf79159d371183e5751602b98aface3fe96",
    adapter: "0xf748b2dd137ec2f61f0b9b85311e001f378019a412672bcdb78eebcae7c04810",
    reserve: "0x67d27897e2d2a52497b6679504215a72868bfdc0153ae1181e85642e796f1fef",
  },
  blocks: {
    pool: 11614331,
    vault: 11614332,
    adapter: 11614333,
    reserve: 11614334,
  },
  assetClassification: "OFFICIAL_ZAMA_TESTNET_MOCK_ASSET",
  yieldProfile: "SIMULATED_YIELD_FOR_SEPOLIA_DEMO",
} as const satisfies VeilpotProductionDeployment;

/**
 * Backwards-compatible name for the already frozen V1 production deployment.
 *
 * Existing V1 evidence/tests intentionally continue to use this alias.
 * New V2 frontend integration must use VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT
 * or VEILPOT_SEPOLIA_V2_DEPLOYMENT explicitly.
 */
export const VEILPOT_SEPOLIA_DEPLOYMENT = VEILPOT_SEPOLIA_V1_DEPLOYMENT;

export interface VeilpotV2ProductionDeployment {
  readonly profile: "VEILPOT_V2_PRODUCTION_SEPOLIA_DEPLOYMENT";
  readonly network: "sepolia";
  readonly chainId: 11155111;

  readonly deploymentEvidenceCommit: string;
  readonly deploymentEvidenceSha256: string;
  readonly deploymentJournalSha256: string;
  readonly deploymentSourceCommit: string;
  readonly deploymentPlanSha256: string;

  readonly deployer: Address;
  readonly confidentialToken: Address;
  readonly wrappersRegistry: Address;

  readonly pool: Address;
  readonly engine: Address;
  readonly vault: Address;
  readonly adapter: Address;
  readonly reserve: Address;

  readonly transactions: {
    readonly pool: Hex;
    readonly vault: Hex;
    readonly adapter: Hex;
    readonly reserve: Hex;
  };

  readonly blocks: {
    readonly pool: number;
    readonly vault: number;
    readonly adapter: number;
    readonly reserve: number;
  };

  readonly engineCreation: {
    readonly method: "POOL_CREATE";
    readonly parentTransaction: Hex;
    readonly parentBlock: number;
  };

  readonly assetClassification: "OFFICIAL_ZAMA_TESTNET_MOCK_ASSET";

  readonly yieldProfile: "SIMULATED_YIELD_V2_3_PRIZE";
}

export const VEILPOT_SEPOLIA_V2_DEPLOYMENT = {
  profile: "VEILPOT_V2_PRODUCTION_SEPOLIA_DEPLOYMENT",
  network: "sepolia",
  chainId: 11155111,

  deploymentEvidenceCommit: "b24ce24fa8dcc5fb9eecbbc209e4ce5d9f7bd9f1",

  deploymentEvidenceSha256: "536923d9a87d5238ade2837d72135c44738e6c55ab5e9a98f9c63bd6af866971",

  deploymentJournalSha256: "fbc324dfc39e72da7856ebfa7fb5affcf4b86efe48437011d9520466b13bbe69",

  deploymentSourceCommit: "1fd76c6542af8e84aaf8630d285653ac43cd564a",

  deploymentPlanSha256: "f58be73b6dc50ec09ae88e2e3ba5416967e71260182a9da4c14c498b0a1296d6",

  deployer: "0x1f87Ae197af539253978d435aD45cCf28Fb95024",

  confidentialToken: "0x4E7B06D78965594eB5EF5414c357ca21E1554491",

  wrappersRegistry: "0x2f0750Bbb0A246059d80e94c454586a7F27a128e",

  pool: "0x6F74fCadDc359159D0799fc9054642aB1f357161",

  engine: "0x6cfb163fC9483D0131e2b79c8c8DEFca7A17C232",

  vault: "0xF724E327b94cCf09936cbd84990A71A40b99ad85",

  adapter: "0x40DC00dDB52a1cD7864322e8E938e73f5D494D35",

  reserve: "0xCFfA037b25c151FBba0A909d2435D00522CdB00B",

  transactions: {
    pool: "0xf7325e7f2842dbdadf6599872c833ecef0fb3e0b6a7d20ac8d6e2d43e58451e0",

    vault: "0x06642bab620d14f29772d4c402332fd136a6ebbb77240478f32c6350e5d6ce4f",

    adapter: "0xc3d2cf2cd51b08801c0bc089f21d18d6ec5842c4d5f1091d17776450e455a715",

    reserve: "0xdb6d2814d952a10bcbd6e2f58b6fd0fa9364f9b2eb47d7a74bbdc3d82c989f57",
  },

  blocks: {
    pool: 11639048,
    vault: 11639049,
    adapter: 11639050,
    reserve: 11639051,
  },

  engineCreation: {
    method: "POOL_CREATE",
    parentTransaction: "0xf7325e7f2842dbdadf6599872c833ecef0fb3e0b6a7d20ac8d6e2d43e58451e0",
    parentBlock: 11639048,
  },

  assetClassification: "OFFICIAL_ZAMA_TESTNET_MOCK_ASSET",

  yieldProfile: "SIMULATED_YIELD_V2_3_PRIZE",
} as const satisfies VeilpotV2ProductionDeployment;

/**
 * Integration-branch target.
 *
 * Merely exporting this value performs no transaction and does not affect the
 * existing production Vercel deployment.
 */
export const VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT = VEILPOT_SEPOLIA_V2_DEPLOYMENT;

export const SUPPORTED_REGISTRATION_VERSION = 1n;
export const REGISTRATION_BOND_WEI = 1_000_000_000_000_000n;
export const MAX_AUTOPILOT_EXECUTIONS = 1_024;
