import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

import { MAX_AUTOPILOT_EXECUTIONS } from "./deployment.js";
import { assertNonzeroBytes32, assertUint64, type Hex } from "./types.js";

export interface AutopilotScheduleWindow {
  readonly notBefore: bigint;
  readonly notAfter: bigint;
}

export interface CommittedAutopilotScheduleWindow extends AutopilotScheduleWindow {
  readonly index: bigint;
  readonly proof: readonly Hex[];
}

export interface AutopilotScheduleCommitment {
  readonly root: Hex;
  readonly executionCount: number;
  readonly windows: readonly CommittedAutopilotScheduleWindow[];
}

export function buildAutopilotSchedule(
  planId: Hex,
  windows: readonly AutopilotScheduleWindow[],
): AutopilotScheduleCommitment {
  assertNonzeroBytes32(planId, "planId");

  if (windows.length === 0 || windows.length > MAX_AUTOPILOT_EXECUTIONS) {
    throw new RangeError(
      `Autopilot schedule must contain between 1 and ${String(MAX_AUTOPILOT_EXECUTIONS)} windows`,
    );
  }

  let previousNotAfter: bigint | undefined;

  const values = windows.map((window, index) => {
    assertUint64(window.notBefore, `schedule[${String(index)}].notBefore`);
    assertUint64(window.notAfter, `schedule[${String(index)}].notAfter`);

    if (window.notBefore > window.notAfter) {
      throw new RangeError(`schedule[${String(index)}] notBefore must be <= notAfter`);
    }

    if (previousNotAfter !== undefined && window.notBefore <= previousNotAfter) {
      throw new RangeError(
        `schedule[${String(index)}] must begin strictly after the prior window ends`,
      );
    }

    previousNotAfter = window.notAfter;
    return [planId, BigInt(index), window.notBefore, window.notAfter];
  });

  const tree = StandardMerkleTree.of(values, ["bytes32", "uint256", "uint64", "uint64"]);

  return {
    root: tree.root as Hex,
    executionCount: windows.length,
    windows: windows.map((window, index) => ({
      index: BigInt(index),
      notBefore: window.notBefore,
      notAfter: window.notAfter,
      proof: tree.getProof(index) as Hex[],
    })),
  };
}
