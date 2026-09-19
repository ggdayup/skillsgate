import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseInstallCommand,
  tryParseInstallCommand,
  unsupportedSourceReason,
  mapUpstreamAgentName,
  formatInstallCommand,
} from "./parse-install-command";

describe("parseInstallCommand — command detection", () => {
  it("parses the canonical README command", () => {
    const parsed = parseInstallCommand("npx skills add humanlayer/skills --skill show-me");

    assert.equal(parsed.wasCommand, true);
    assert.equal(parsed.source.type, "github");
    assert.equal(parsed.source.owner, "humanlayer");
    assert.equal(parsed.source.repo, "skills");
    assert.deepEqual(parsed.skillFilter, ["show-me"]);
  });

  it("accepts every runner the ecosystem uses", () => {
    const forms = [
      "npx skills add owner/repo",
      "bunx skills add owner/repo",
      "pnpm dlx skills add owner/repo",
      "yarn dlx skills add owner/repo",
      "npm exec skills add owner/repo",
      "skills add owner/repo",
    ];

    for (const form of forms) {
      const parsed = parseInstallCommand(form);
      assert.equal(parsed.wasCommand, true, `should detect command in: ${form}`);
      assert.equal(parsed.source.repo, "repo", `should parse source in: ${form}`);
    }
  });

  it("accepts a pinned skills version", () => {
    const parsed = parseInstallCommand("npx skills@latest add owner/repo --skill x");
    assert.equal(parsed.wasCommand, true);
    assert.deepEqual(parsed.skillFilter, ["x"]);
  });

  it("accepts the add subcommand aliases", () => {
    for (const alias of ["add", "a", "install", "i"]) {
      const parsed = parseInstallCommand(`npx skills ${alias} owner/repo`);
      assert.equal(parsed.wasCommand, true, `alias ${alias} should work`);
    }
  });

  it("treats a bare source as a plain source, not a command", () => {
    for (const bare of ["owner/repo", "owner/repo@skill", "https://github.com/owner/repo"]) {
      const parsed = parseInstallCommand(bare);
      assert.equal(parsed.wasCommand, false, `${bare} should not be a command`);
    }
  });

  it("strips a leading shell prompt", () => {
    const parsed = parseInstallCommand("$ npx skills add owner/repo --skill x");
    assert.equal(parsed.wasCommand, true);
    assert.deepEqual(parsed.skillFilter, ["x"]);
  });

  it("joins backslash line continuations", () => {
    const parsed = parseInstallCommand("npx skills add owner/repo \\\n  --skill x");
    assert.equal(parsed.wasCommand, true);
    assert.deepEqual(parsed.skillFilter, ["x"]);
    assert.deepEqual(parsed.extraLines, []);
  });

  it("keeps a second pasted line out of the parse", () => {
    const parsed = parseInstallCommand(
      "npx skills add owner/repo --skill a\nnpx skills add other/repo",
    );
    assert.deepEqual(parsed.skillFilter, ["a"]);
    assert.deepEqual(parsed.extraLines, ["npx skills add other/repo"]);
  });
});

describe("parseInstallCommand — flags", () => {
  it("collects space-separated varargs, matching upstream", () => {
    const parsed = parseInstallCommand("npx skills add owner/repo -s alpha beta gamma");
    assert.deepEqual(parsed.skillFilter, ["alpha", "beta", "gamma"]);
  });

  it("does NOT split on commas, matching upstream", () => {
    const parsed = parseInstallCommand("npx skills add owner/repo --skill alpha,beta");
    assert.deepEqual(parsed.skillFilter, ["alpha,beta"]);
  });

  it("stops varargs at the next flag", () => {
    const parsed = parseInstallCommand("npx skills add owner/repo -s alpha -g");
    assert.deepEqual(parsed.skillFilter, ["alpha"]);
    assert.equal(parsed.requestedScope, "global");
  });

  it("handles quoted skill names containing spaces", () => {
    const parsed = parseInstallCommand('npx skills add owner/repo --skill "Convex Best Practices"');
    assert.deepEqual(parsed.skillFilter, ["Convex Best Practices"]);
  });

  it("maps -g, --copy, --full-depth, -l and -y", () => {
    const parsed = parseInstallCommand(
      "npx skills add owner/repo -g --copy --full-depth -l -y",
    );
    assert.equal(parsed.requestedScope, "global");
    assert.equal(parsed.method, "copy");
    assert.equal(parsed.fullDepth, true);
    assert.equal(parsed.list, true);
    assert.equal(parsed.yes, true);
  });

  it("leaves scope unspecified when -g is absent", () => {
    const parsed = parseInstallCommand("npx skills add owner/repo");
    assert.equal(parsed.requestedScope, "unspecified");
    assert.equal(parsed.method, "unspecified");
  });

  it("expands --all to upstream's shorthand", () => {
    const parsed = parseInstallCommand("npx skills add owner/repo --all");
    assert.deepEqual(parsed.skillFilter, ["*"]);
    assert.deepEqual(parsed.agents, ["*"]);
    assert.equal(parsed.yes, true);
  });

  it("treats a literal '*' filter as all", () => {
    const parsed = parseInstallCommand("npx skills add owner/repo --skill '*'");
    assert.deepEqual(parsed.skillFilter, ["*"]);
  });

  it("records flags it does not act on instead of failing", () => {
    const parsed = parseInstallCommand(
      'npx skills add owner/repo --json --metadata {"a":1} --subagent root --wat',
    );
    assert.deepEqual(parsed.ignoredFlags, ["--json", "--metadata", "--subagent", "--wat"]);
    assert.equal(parsed.source.repo, "repo");
  });

  it("collects extra sources without failing", () => {
    const parsed = parseInstallCommand("npx skills add first/repo second/repo");
    assert.equal(parsed.source.repo, "repo");
    assert.deepEqual(parsed.extraSources, ["second/repo"]);
  });

  it("falls back to the source's own @skill filter", () => {
    const parsed = parseInstallCommand("npx skills add owner/repo@from-source");
    assert.deepEqual(parsed.skillFilter, ["from-source"]);
  });

  it("lets an explicit --skill win over the @skill form", () => {
    const parsed = parseInstallCommand("npx skills add owner/repo@from-source --skill explicit");
    assert.deepEqual(parsed.skillFilter, ["explicit"]);
  });
});

describe("parseInstallCommand — agent slugs", () => {
  it("collects greedy agent varargs", () => {
    const parsed = parseInstallCommand("npx skills add owner/repo -a claude-code cursor");
    assert.deepEqual(parsed.agents, ["claude-code", "cursor"]);
  });

  it("maps the four slugs that differ from upstream", () => {
    assert.equal(mapUpstreamAgentName("codex"), "codex-cli");
    assert.equal(mapUpstreamAgentName("droid"), "droid-cli");
    assert.equal(mapUpstreamAgentName("kilo"), "kilo-code");
    assert.equal(mapUpstreamAgentName("roo"), "roo-code");
  });

  it("leaves already-matching slugs alone", () => {
    // Verified against upstream's agent table — these are identical upstream.
    for (const slug of ["claude-code", "github-copilot", "cursor", "cline", "opencode", "trae"]) {
      assert.equal(mapUpstreamAgentName(slug), slug);
    }
  });

  it("passes '*' through untouched", () => {
    const parsed = parseInstallCommand("npx skills add owner/repo --agent '*'");
    assert.deepEqual(parsed.agents, ["*"]);
  });
});

describe("parseInstallCommand — upstream-only sources", () => {
  it("rejects GitLab with a specific reason", () => {
    assert.match(unsupportedSourceReason("https://gitlab.com/org/repo") ?? "", /GitLab/);
    assert.throws(
      () => parseInstallCommand("npx skills add https://gitlab.com/org/repo"),
      /GitLab/,
    );
  });

  it("rejects Azure Repos with a specific reason", () => {
    assert.match(
      unsupportedSourceReason("https://dev.azure.com/org/project/_git/repo") ?? "",
      /Azure/,
    );
  });

  it("rejects generic git and SSH with a specific reason", () => {
    assert.match(unsupportedSourceReason("git@github.com:o/r.git") ?? "", /git\/SSH/);
    assert.match(unsupportedSourceReason("ssh://git@host:7999/o/r.git") ?? "", /git\/SSH/);
  });

  it("rejects archives and direct downloads with a specific reason", () => {
    assert.match(unsupportedSourceReason("https://example.com/skill.zip") ?? "", /Archive/);
    assert.match(unsupportedSourceReason("https://example.com/download/my-skill") ?? "", /github\.com/);
  });

  it("returns null for sources we can install", () => {
    assert.equal(unsupportedSourceReason("owner/repo"), null);
    assert.equal(unsupportedSourceReason("https://github.com/owner/repo"), null);
    assert.equal(unsupportedSourceReason("~/local/skills"), null);
  });
});

describe("parseInstallCommand — error handling", () => {
  it("names the subcommand when it is not an install command", () => {
    assert.throws(() => parseInstallCommand("npx skills list"), /skills list/);
    assert.throws(() => parseInstallCommand("npx skills find react"), /skills find/);
  });

  it("rejects an empty input", () => {
    assert.throws(() => parseInstallCommand("   "), /Nothing to parse/);
  });

  it("rejects a command with no source", () => {
    assert.throws(() => parseInstallCommand("npx skills add --skill x"), /No source found/);
  });

  it("reports failures through tryParseInstallCommand instead of throwing", () => {
    const result = tryParseInstallCommand("npx skills add https://gitlab.com/o/r");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /GitLab/);
  });
});

describe("formatInstallCommand — round-trips through the parser", () => {
  it("round-trips a simple skill name", () => {
    const command = formatInstallCommand("humanlayer/skills", "show-me");
    assert.equal(command, "npx skills add humanlayer/skills --skill show-me");

    const parsed = parseInstallCommand(command);
    assert.deepEqual(parsed.skillFilter, ["show-me"]);
    assert.equal(parsed.source.owner, "humanlayer");
  });

  it("round-trips a skill name containing spaces", () => {
    const command = formatInstallCommand("owner/repo", "Convex Best Practices");
    assert.equal(command, 'npx skills add owner/repo --skill "Convex Best Practices"');

    const parsed = parseInstallCommand(command);
    assert.deepEqual(parsed.skillFilter, ["Convex Best Practices"]);
  });

  it("omits the flag when no skill is given", () => {
    assert.equal(formatInstallCommand("owner/repo"), "npx skills add owner/repo");
    assert.equal(formatInstallCommand("owner/repo", "*"), "npx skills add owner/repo");
  });
});
