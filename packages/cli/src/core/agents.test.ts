import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agents } from "./agents.js";
import type { AgentType } from "../types.js";

describe("agents registry", () => {
  const expectedNewAgents: AgentType[] = [
    "antigravity",
    "antigravity-ide",
    "antigravity-cli",
    "codebuddy",
    "codebuddy-cn",
    "workbuddy",
    "workbuddy-ai",
    "trae-cn",
    "pi",
    "mercury",
  ];

  it("should have all 10 new agents registered", () => {
    for (const agentName of expectedNewAgents) {
      assert.ok(
        agents[agentName],
        `Agent "${agentName}" should be present in agents registry`
      );
      assert.equal(
        agents[agentName].name,
        agentName,
        `Agent "${agentName}" name property must match key`
      );
      assert.ok(
        agents[agentName].displayName.length > 0,
        `Agent "${agentName}" must have a non-empty displayName`
      );
      assert.ok(
        agents[agentName].skillsDir.length > 0,
        `Agent "${agentName}" must have a non-empty skillsDir`
      );
      assert.ok(
        agents[agentName].globalSkillsDir.length > 0,
        `Agent "${agentName}" must have a non-empty globalSkillsDir`
      );
      assert.equal(
        typeof agents[agentName].detectInstalled,
        "function",
        `Agent "${agentName}" must have a detectInstalled function`
      );
    }
  });

  it("should register 29 total coding agents", () => {
    const keys = Object.keys(agents);
    assert.equal(keys.length, 29, `Expected 29 agents registered, found ${keys.length}`);
  });

  it("should treat the three Antigravity interfaces as separate tools", () => {
    // `~/.gemini` alone used to be enough to report "Antigravity installed",
    // which flagged machines that only ever ran Gemini CLI.
    const dirs = ["antigravity", "antigravity-ide", "antigravity-cli"].map(
      (name) => agents[name].globalSkillsDir,
    );
    assert.equal(new Set(dirs).size, 3, `Expected 3 distinct skills dirs, got ${dirs.join(", ")}`);
    for (const name of ["antigravity", "antigravity-ide", "antigravity-cli"]) {
      assert.ok(
        agents[name].globalSkillsDir.includes("gemini"),
        `Agent "${name}" should resolve under ~/.gemini`,
      );
    }
  });

  it("should no longer expose a `universal` pseudo-agent", () => {
    // ~/.agents/skills is the core skill set, not a tool you install into.
    // See packages/cli/src/core/core-skills.ts.
    assert.equal(agents["universal"], undefined);
  });

  it("should safely evaluate detectInstalled without crashing", async () => {
    for (const agentName of expectedNewAgents) {
      const isInstalled = await agents[agentName].detectInstalled();
      assert.equal(typeof isInstalled, "boolean");
    }
  });
});
