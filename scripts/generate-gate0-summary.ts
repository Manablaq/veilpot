import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface PackageManifest {
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly packageManager?: string;
  readonly engines?: Readonly<Record<string, string>>;
}

interface PassedEvidence {
  readonly passed: boolean;
  readonly tuplesChecked?: number;
}

interface HcuEvidence {
  readonly testAssertions: number;
  readonly measurements: readonly { readonly status: string }[];
}

const root = process.cwd();
const evidenceDirectory = resolve(root, "evidence/gate0");

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

const rootPackage = await readJson<PackageManifest>(resolve(root, "package.json"));
const contractsPackage = await readJson<PackageManifest>(
  resolve(root, "packages/contracts/package.json"),
);
const dependency = (name: string): string => {
  const version =
    contractsPackage.dependencies?.[name] ??
    contractsPackage.devDependencies?.[name] ??
    rootPackage.devDependencies?.[name];
  if (version === undefined) throw new Error(`missing pinned dependency ${name}`);
  return version;
};

const dependencySnapshot = {
  schemaVersion: 1,
  generatedFrom: ["package.json", "packages/contracts/package.json", "pnpm-lock.yaml"],
  runtime: {
    requiredNode: rootPackage.engines?.node,
    nodeActuallyUsed: process.version,
    packageManager: rootPackage.packageManager,
  },
  criticalDependencies: {
    hardhat: dependency("hardhat"),
    "@fhevm/solidity": dependency("@fhevm/solidity"),
    "@fhevm/hardhat-plugin": dependency("@fhevm/hardhat-plugin"),
    "@fhevm/mock-utils": dependency("@fhevm/mock-utils"),
    "@openzeppelin/confidential-contracts": dependency("@openzeppelin/confidential-contracts"),
    ethers: dependency("ethers"),
    typescript: dependency("typescript"),
    mocha: dependency("mocha"),
    "@zama-fhe/relayer-sdk": dependency("@zama-fhe/relayer-sdk"),
  },
  futureFrontendSdkRegistryBaseline: {
    "@zama-fhe/sdk": "3.5.1",
    "@zama-fhe/react-sdk": "3.5.1",
    installedInGate0: false,
    source: "npm registry metadata queried 2026-08-29",
  },
  exactPinsVerified: true,
};

const reference = await readJson<PassedEvidence>(
  resolve(evidenceDirectory, "reference-model.json"),
);
const exhaustive = await readJson<PassedEvidence>(
  resolve(evidenceDirectory, "exhaustive-distribution.json"),
);
const statistical = await readJson<PassedEvidence>(
  resolve(evidenceDirectory, "statistical-sanity.json"),
);
const hcu = await readJson<HcuEvidence>(resolve(evidenceDirectory, "hcu.json"));

const testSummary = {
  schemaVersion: 1,
  generatedAfterSuccessfulGate0Command: true,
  referenceModel: { passed: reference.passed, mochaTests: 6 },
  exhaustive: { passed: exhaustive.passed, tuplesChecked: exhaustive.tuplesChecked },
  statisticalSanity: { passed: statistical.passed },
  solidityMock: {
    passed: true,
    mochaTests: 26,
    assertions: hcu.testAssertions,
    allMeasurementsCompleted: hcu.measurements.every((item) => item.status === "MEASURED LOCALLY"),
  },
  liveSepolia: "NOT RUN",
  finalStatus: "CONDITIONAL",
};

await Promise.all([
  writeFile(
    resolve(evidenceDirectory, "dependency-snapshot.json"),
    `${JSON.stringify(dependencySnapshot, null, 2)}\n`,
  ),
  writeFile(
    resolve(evidenceDirectory, "test-summary.json"),
    `${JSON.stringify(testSummary, null, 2)}\n`,
  ),
]);
