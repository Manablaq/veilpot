import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { keccak256 } from "ethers";

interface Artifact {
  readonly deployedBytecode: string;
}

interface BuildInfo {
  readonly solcLongVersion: string;
  readonly input: {
    readonly settings: Record<string, unknown>;
    readonly sources: Record<string, { readonly content: string }>;
  };
}

interface RuntimeDetails {
  readonly fullHash: string;
  readonly fullBytes: number;
  readonly executableBodyHash: string;
  readonly executableBodyBytes: number;
  readonly metadataLength: number;
  readonly metadataHash: string;
  readonly firstDifferingByteOffset?: number;
}

function hashBytes(value: Uint8Array): string {
  return keccak256(`0x${Buffer.from(value).toString("hex")}`);
}

function runtimeDetails(artifact: Artifact): RuntimeDetails {
  const runtime = Buffer.from(artifact.deployedBytecode.slice(2), "hex");
  const metadataLength = runtime.readUInt16BE(runtime.length - 2);
  const executableBody = runtime.subarray(0, runtime.length - metadataLength - 2);
  const metadata = runtime.subarray(runtime.length - metadataLength - 2);
  return {
    fullHash: keccak256(artifact.deployedBytecode),
    fullBytes: runtime.length,
    executableBodyHash: hashBytes(executableBody),
    executableBodyBytes: executableBody.length,
    metadataLength,
    metadataHash: hashBytes(metadata),
  };
}

function compilerInputHash(buildInfo: BuildInfo): string {
  return hashBytes(Buffer.from(JSON.stringify(buildInfo.input)));
}

function sourceDifferences(
  defaultBuild: BuildInfo,
  sepoliaBuild: BuildInfo,
): readonly JsonRecord[] {
  const paths = new Set([
    ...Object.keys(defaultBuild.input.sources),
    ...Object.keys(sepoliaBuild.input.sources),
  ]);
  return [...paths].sort().flatMap((path) => {
    const defaultSource = defaultBuild.input.sources[path]?.content;
    const sepoliaSource = sepoliaBuild.input.sources[path]?.content;
    if (defaultSource === sepoliaSource) return [];
    return [
      {
        path,
        defaultSourceHash:
          defaultSource === undefined ? null : hashBytes(Buffer.from(defaultSource)),
        sepoliaSourceHash:
          sepoliaSource === undefined ? null : hashBytes(Buffer.from(sepoliaSource)),
        defaultSourceBytes: defaultSource?.length ?? null,
        sepoliaSourceBytes: sepoliaSource?.length ?? null,
      },
    ];
  });
}

type JsonRecord = Record<string, string | number | null>;

function firstDifferingByteOffset(
  defaultArtifact: Artifact,
  sepoliaArtifact: Artifact,
): number | null {
  const left = Buffer.from(defaultArtifact.deployedBytecode.slice(2), "hex");
  const right = Buffer.from(sepoliaArtifact.deployedBytecode.slice(2), "hex");
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? null : Math.min(left.length, right.length);
}

async function parse<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function compare(
  defaultArtifactPath: string,
  defaultBuildInfoPath: string,
  sepoliaArtifactPath: string,
  sepoliaBuildInfoPath: string,
): Promise<Record<string, unknown>> {
  const [defaultArtifact, defaultBuild, sepoliaArtifact, sepoliaBuild] = await Promise.all([
    parse<Artifact>(defaultArtifactPath),
    parse<BuildInfo>(defaultBuildInfoPath),
    parse<Artifact>(sepoliaArtifactPath),
    parse<BuildInfo>(sepoliaBuildInfoPath),
  ]);
  const defaultRuntime = runtimeDetails(defaultArtifact);
  const sepoliaRuntime = runtimeDetails(sepoliaArtifact);
  return {
    defaultCompilation: {
      ...defaultRuntime,
      compilerVersion: defaultBuild.solcLongVersion,
      compilerInputHash: compilerInputHash(defaultBuild),
      settings: defaultBuild.input.settings,
    },
    sepoliaCompilation: {
      ...sepoliaRuntime,
      compilerVersion: sepoliaBuild.solcLongVersion,
      compilerInputHash: compilerInputHash(sepoliaBuild),
      settings: sepoliaBuild.input.settings,
    },
    fullRuntimeMatch: defaultRuntime.fullHash === sepoliaRuntime.fullHash,
    executableBodyMatch: defaultRuntime.executableBodyHash === sepoliaRuntime.executableBodyHash,
    metadataTrailerMatch: defaultRuntime.metadataHash === sepoliaRuntime.metadataHash,
    firstDifferingByteOffset: firstDifferingByteOffset(defaultArtifact, sepoliaArtifact),
    sourceDifferences: sourceDifferences(defaultBuild, sepoliaBuild),
  };
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2);
  if (paths.length !== 8) {
    throw new Error(
      "expected eight paths: historical default/build, historical Sepolia/build, selected default/build, selected Sepolia/build",
    );
  }
  const historical = await compare(paths[0]!, paths[1]!, paths[2]!, paths[3]!);
  const selected = await compare(paths[4]!, paths[5]!, paths[6]!, paths[7]!);
  const output = {
    schemaVersion: 1,
    classification: "MEASURED RESULT from clean Node 22 Hardhat compilation paths",
    historicalMismatch: historical,
    selectedCompilerBaseline: selected,
  };
  await writeFile(
    resolve(process.cwd(), "../../evidence/gate0/bytecode-reproducibility.json"),
    `${JSON.stringify(output, null, 2)}\n`,
  );
}

void main();
