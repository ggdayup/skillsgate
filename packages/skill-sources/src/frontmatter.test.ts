import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatterFallback, parseSkillFrontmatter } from "./frontmatter";

describe("parseFrontmatterFallback", () => {
  it("parses frontmatter with unquoted colons in values", () => {
    const raw = `---
name: ollaya-decisions
description: Make typed, calibrated decisions about text or JSON with local decision models served by Ollaya: classify (choice), rate (score) or check a yes/no statement (noul) in milliseconds, with probabilities you can threshold.
license: Apache-2.0
metadata:
  homepage: https://ollaya.dev
  team: Ollaya Dev
---
# Content`;

    const res = parseFrontmatterFallback(raw);
    assert.ok(res);
    assert.equal(res.name, "ollaya-decisions");
    assert.equal(
      res.description,
      "Make typed, calibrated decisions about text or JSON with local decision models served by Ollaya: classify (choice), rate (score) or check a yes/no statement (noul) in milliseconds, with probabilities you can threshold.",
    );
    assert.equal(res.license, "Apache-2.0");
    assert.deepEqual(res.metadata, {
      homepage: "https://ollaya.dev",
      team: "Ollaya Dev",
    });
  });

  it("parses folded multiline descriptions", () => {
    const raw = `---
name: test-skill
description: >-
  Line 1 with: colons.
  Line 2 continues here.
---
# Content`;

    const res = parseFrontmatterFallback(raw);
    assert.ok(res);
    assert.equal(res.name, "test-skill");
    assert.equal(res.description, "Line 1 with: colons. Line 2 continues here.");
  });

  it("parses indented multiline descriptions without block scalar", () => {
    const raw = `---
name: test-skill
description:
  First line.
  Second line.
---
# Content`;

    const res = parseFrontmatterFallback(raw);
    assert.ok(res);
    assert.equal(res.name, "test-skill");
    assert.equal(res.description, "First line. Second line.");
  });

  it("strips wrapping quotes from values", () => {
    const raw = `---
name: "quoted-name"
description: 'quoted description: here'
---
# Content`;

    const res = parseFrontmatterFallback(raw);
    assert.ok(res);
    assert.equal(res.name, "quoted-name");
    assert.equal(res.description, "quoted description: here");
  });

  it("returns null when no frontmatter delimiters exist", () => {
    const raw = `# Just markdown\nNo frontmatter here.`;
    assert.equal(parseFrontmatterFallback(raw), null);
  });
});

describe("parseSkillFrontmatter", () => {
  it("uses standard yaml parser when valid", () => {
    const raw = `---
name: valid-skill
description: valid description
---`;
    const mockYaml = () => ({ data: { name: "valid-skill", description: "valid description" } });
    const res = parseSkillFrontmatter(raw, mockYaml);
    assert.ok(res);
    assert.equal(res.name, "valid-skill");
  });

  it("falls back seamlessly when standard yaml parser throws", () => {
    const raw = `---
name: ollaya-decisions
description: unquoted: colon here
---`;
    const throwingYaml = () => {
      throw new Error("YAML syntax error");
    };
    const res = parseSkillFrontmatter(raw, throwingYaml);
    assert.ok(res);
    assert.equal(res.name, "ollaya-decisions");
    assert.equal(res.description, "unquoted: colon here");
  });

  it("merges with fallback when standard yaml parser returns incomplete fields", () => {
    const raw = `---
name: partial-skill
description: rescued by fallback
license: MIT
---`;
    const incompleteYaml = () => ({ data: { license: "MIT" } });
    const res = parseSkillFrontmatter(raw, incompleteYaml);
    assert.ok(res);
    assert.equal(res.name, "partial-skill");
    assert.equal(res.description, "rescued by fallback");
    assert.equal(res.license, "MIT");
  });
});
