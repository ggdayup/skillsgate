import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseSkillMd, discoverSkills } from "./skill-discovery.js";

describe("skill-discovery — parseSkillMd and discoverSkills resilience", () => {
  it("parses SKILL.md containing unquoted colons in description", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "skill-disc-"));
    try {
      const skillDir = path.join(tmp, "ollaya-decisions");
      await fs.mkdir(skillDir, { recursive: true });
      const skillMd = path.join(skillDir, "SKILL.md");
      const content = `---
name: ollaya-decisions
description: Make typed, calibrated decisions about text or JSON with local decision models served by Ollaya: classify (choice), rate (score) or check a yes/no statement (noul) in milliseconds, with probabilities you can threshold.
license: Apache-2.0
---
# Ollaya Decisions
Content here.`;
      await fs.writeFile(skillMd, content, "utf-8");

      const parsed = await parseSkillMd(skillMd);
      assert.ok(parsed, "should parse successfully");
      assert.equal(parsed.name, "ollaya-decisions");
      assert.ok(parsed.description.includes("served by Ollaya: classify"));

      const discovered = await discoverSkills(tmp);
      assert.equal(discovered.length, 1);
      assert.equal(discovered[0]!.name, "ollaya-decisions");

      const discoveredSubpath = await discoverSkills(tmp, "ollaya-decisions");
      assert.equal(discoveredSubpath.length, 1);
      assert.equal(discoveredSubpath[0]!.name, "ollaya-decisions");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
