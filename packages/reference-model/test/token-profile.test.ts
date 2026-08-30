import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect } from "chai";

describe("Gate 1A Sepolia token profile", function () {
  it("uses one canonical wrappers registry address in every Gate 1 document", function () {
    const root = join(process.cwd(), "../..");
    const canonical = "0x2f0750Bbb0A246059d80e94c454586a7F27a128e";
    const malformed = `${canonical}0`;
    for (const filename of [
      "GATE_1_ARCHITECTURE.md",
      "GATE_1_SECURITY_MODEL.md",
      "GATE_1_PRIVACY_LEDGER.md",
      "GATE_1_TEST_PLAN.md",
    ]) {
      const content = readFileSync(join(root, "docs", filename), "utf8");
      expect(content).not.to.include(malformed);
      if (filename === "GATE_1_ARCHITECTURE.md" || filename === "GATE_1_SECURITY_MODEL.md") {
        expect(content).to.include(canonical);
      }
    }
  });
});
