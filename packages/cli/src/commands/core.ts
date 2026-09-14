import fs from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";
import {
  AgentType,
  CoreSyncItem,
  CoreSyncPlan,
} from "../types.js";
import { CANONICAL_SKILLS_DIR, CORE_SKILLS_DIR } from "../constants.js";
import { agents, detectInstalledAgents } from "../core/agents.js";
import {
  applyCoreSync,
  getCoreStatus,
  installSkillToCore,
  listCoreEntries,
  planCoreSync,
  promoteToCore,
  readCoreConfig,
  removeCoreSkill,
  setExclusion,
  syncCore,
} from "../core/core-skills.js";
import { parseSkillMd } from "../core/skill-discovery.js";
import { fmt, shortenPath } from "../ui/format.js";

// ---------- option parsing ----------

interface CoreOptions {
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  agent?: string[];
  from?: string;
  positional: string[];
}

function parseOptions(args: string[]): CoreOptions {
  const opts: CoreOptions = {
    dryRun: false,
    yes: false,
    json: false,
    agent: undefined,
    positional: [],
  };
  const agentList: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run" || arg === "-n") opts.dryRun = true;
    else if (arg === "--yes" || arg === "-y") opts.yes = true;
    else if (arg === "--json") opts.json = true;
    else if ((arg === "-a" || arg === "--agent") && args[i + 1])
      agentList.push(args[++i]);
    else if (arg === "--from" && args[i + 1]) opts.from = args[++i];
    else if (!arg.startsWith("-")) opts.positional.push(arg);
  }

  if (agentList.length > 0) opts.agent = agentList;
  return opts;
}

function actionLabel(action: CoreSyncItem["action"]): string {
  switch (action) {
    case "link":
      return fmt.success("link");
    case "unlink":
      return fmt.warn("unlink");
    case "skip-conflict":
      return fmt.error("conflict");
    case "skip-excluded":
      return fmt.dim("excluded");
    case "skip-present":
      return fmt.dim("ok");
  }
}

// ---------- entry point ----------

export async function runCore(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printCoreHelp();
    return;
  }

  const sub = args[0];
  const opts = parseOptions(args.slice(1));

  switch (sub) {
    case undefined:
    case "list":
    case "ls":
      await runCoreList(opts);
      break;
    case "status":
      await runCoreStatus(opts);
      break;
    case "sync":
      await runCoreSync(opts);
      break;
    case "add":
      await runCoreAdd(opts);
      break;
    case "remove":
    case "rm":
      await runCoreRemove(opts);
      break;
    case "exclude":
      await runCoreExclude(opts, true);
      break;
    case "include":
      await runCoreExclude(opts, false);
      break;
    default:
      console.error(fmt.error(`Unknown core subcommand: ${sub}`));
      console.error(
        `  Run ${fmt.bold("skillsgate core --help")} for usage.`,
      );
      process.exit(1);
  }
}

// ---------- core list ----------

async function runCoreList(opts: CoreOptions): Promise<void> {
  const core = await listCoreEntries();
  const cfg = await readCoreConfig();
  const detected = await detectInstalledAgents();

  if (opts.json) {
    console.log(
      JSON.stringify(
        { coreDir: CORE_SKILLS_DIR(), count: core.length, skills: core.map((c) => c.name), exclusions: cfg.exclusions },
        null,
        2,
      ),
    );
    return;
  }

  console.log();
  console.log(fmt.bold(`  Core skills (${core.length})`));
  console.log(`  ${fmt.dim("Directory:")} ${fmt.path(shortenPath(CORE_SKILLS_DIR()))}`);
  console.log(
    `  ${fmt.dim("Fans out to:")} ${detected.length} detected tool${detected.length === 1 ? "" : "s"}`,
  );
  console.log();

  if (core.length === 0) {
    console.log(fmt.dim("  Core set is empty."));
    console.log();
    return;
  }

  for (const entry of core) {
    console.log(`  ${fmt.skillName(entry.name)}`);
  }
  console.log();
}

// ---------- core status ----------

async function runCoreStatus(opts: CoreOptions): Promise<void> {
  const status = await getCoreStatus({
    agentNames: opts.agent as AgentType[] | undefined,
  });

  if (opts.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (status.length === 0) {
    console.log(fmt.dim("  No tools detected."));
    return;
  }

  console.log();
  console.log(fmt.bold("  Core fan-out status"));
  console.log();

  for (const entry of status) {
    const clean =
      entry.missing.length === 0 &&
      entry.dangling.length === 0 &&
      entry.conflicts.length === 0;
    const head = clean ? fmt.success("✓") : fmt.warn("•");
    console.log(
      `  ${head} ${fmt.agentName(entry.displayName)} — ${entry.linked} linked` +
        (entry.missing.length > 0
          ? `, ${fmt.warn(`${entry.missing.length} missing`)}`
          : "") +
        (entry.dangling.length > 0
          ? `, ${fmt.warn(`${entry.dangling.length} stale`)}`
          : "") +
        (entry.conflicts.length > 0
          ? `, ${fmt.error(`${entry.conflicts.length} conflict`)}`
          : "") +
        (entry.excluded.length > 0
          ? `, ${fmt.dim(`${entry.excluded.length} excluded`)}`
          : ""),
    );
    if (entry.conflicts.length > 0) {
      console.log(
        `      ${fmt.dim("conflicts:")} ${entry.conflicts.slice(0, 6).join(", ")}` +
          (entry.conflicts.length > 6 ? fmt.dim(` (+${entry.conflicts.length - 6})`) : ""),
      );
    }
    if (entry.dangling.length > 0) {
      console.log(
        `      ${fmt.dim("stale links:")} ${entry.dangling.join(", ")}`,
      );
    }
  }
  console.log();
}

// ---------- core sync ----------

async function printPlan(plan: CoreSyncPlan): Promise<void> {
  const counts = plan.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.action] = (acc[item.action] || 0) + 1;
    return acc;
  }, {});

  console.log();
  console.log(
    fmt.bold(`  Core: ${plan.coreCount} skills → ${plan.agents.length} detected tools`),
  );
  console.log();

  const interesting = plan.items.filter(
    (i) => i.action !== "skip-present",
  );
  if (interesting.length === 0) {
    console.log(fmt.success("  Everything already in sync."));
  } else {
    for (const item of interesting.slice(0, 40)) {
      console.log(
        `  ${actionLabel(item.action).padEnd(20)} ${fmt.agentName(item.displayName)} ${fmt.dim("·")} ${item.skill}` +
          (item.reason ? ` ${fmt.dim(`(${item.reason})`)}` : ""),
      );
    }
    if (interesting.length > 40) {
      console.log(fmt.dim(`  … and ${interesting.length - 40} more`));
    }
  }

  console.log();
  console.log(
    `  ${fmt.success(`${counts.link || 0} to link`)}` +
      `, ${fmt.warn(`${counts.unlink || 0} to unlink`)}` +
      `, ${fmt.error(`${counts["skip-conflict"] || 0} conflicts skipped`)}` +
      `, ${fmt.dim(`${counts["skip-excluded"] || 0} excluded`)}` +
      `, ${fmt.dim(`${counts["skip-present"] || 0} already linked`)}`,
  );
  console.log();
}

async function runCoreSync(opts: CoreOptions): Promise<void> {
  const syncOpts = { agentNames: opts.agent as AgentType[] | undefined };

  if (opts.dryRun) {
    await printPlan(await planCoreSync(syncOpts));
    console.log(fmt.dim("  Dry run — nothing was changed."));
    console.log();
    return;
  }

  const plan = await planCoreSync(syncOpts);
  await printPlan(plan);

  if (opts.json) {
    const result = await applyCoreSync(plan);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const result = await applyCoreSync(plan);
  console.log(
    `  ${fmt.success(`linked ${result.linked}`)}, ` +
      `${fmt.warn(`unlinked ${result.unlinked}`)}, ` +
      `${fmt.dim(`skipped ${result.skippedConflicts} conflicts`)}`,
  );
  if (result.failed.length > 0) {
    console.log();
    console.log(fmt.error(`  ${result.failed.length} failure(s):`));
    for (const f of result.failed.slice(0, 10)) {
      console.log(`    ${f.agent} · ${f.skill}: ${f.error}`);
    }
  }
  console.log();
}

// ---------- core add ----------

async function runCoreAdd(opts: CoreOptions): Promise<void> {
  const name = opts.positional[0];
  if (!name) {
    console.error(fmt.error("Usage: skillsgate core add <name> [--from <agent>]"));
    process.exit(1);
  }

  const coreDir = CORE_SKILLS_DIR();
  const coreTarget = path.join(coreDir, name);

  try {
    await fs.lstat(coreTarget);
    console.log(fmt.warn(`  ${name} is already in the core set.`));
    return;
  } catch {
    // not core yet — continue
  }

  // 1. Promote from an explicit or discovered agent-owned directory.
  const detected = await detectInstalledAgents();
  const candidates = opts.from
    ? detected.filter((a) => a.name === opts.from)
    : detected;

  if (opts.from && candidates.length === 0) {
    console.error(fmt.error(`  Tool not detected: ${opts.from}`));
    process.exit(1);
  }

  for (const agent of candidates) {
    const candidate = path.join(agent.globalSkillsDir, name);
    try {
      const lst = await fs.lstat(candidate);
      if (lst.isSymbolicLink() || !lst.isDirectory()) continue;
    } catch {
      continue;
    }
    const res = await promoteToCore(name, agent.name);
    if (res.ok) {
      console.log(fmt.success(`  Promoted ${name} from ${agent.displayName} into core.`));
      await runCoreSync({ ...opts, dryRun: false });
      return;
    }
    console.error(fmt.error(`  ${res.error}`));
    process.exit(1);
  }

  // 2. Adopt from the non-core store.
  const storeDir = CANONICAL_SKILLS_DIR();
  const storePath = path.join(storeDir, name);
  try {
    const lst = await fs.lstat(storePath);
    if (lst.isDirectory() && !lst.isSymbolicLink()) {
      const skillMd = path.join(storePath, "SKILL.md");
      const parsed = await parseSkillMd(skillMd);
      if (!parsed) {
        console.error(fmt.error(`  ${name} in the store has no valid SKILL.md.`));
        process.exit(1);
      }
      await fs.mkdir(coreDir, { recursive: true });
      await fs.rename(storePath, coreTarget);
      console.log(fmt.success(`  Moved ${name} from .store into the core set.`));
      await runCoreSync({ ...opts, dryRun: false });
      return;
    }
  } catch {
    // not in the store
  }

  console.error(
    fmt.error(
      `  Could not find ${name} as a tool-owned directory or in ${shortenPath(storeDir)}.`,
    ),
  );
  console.error(
    fmt.dim(`  Install it first, or drop the folder into ${shortenPath(coreDir)}.`),
  );
  process.exit(1);
}

// ---------- core remove ----------

async function runCoreRemove(opts: CoreOptions): Promise<void> {
  const name = opts.positional[0];
  if (!name) {
    console.error(fmt.error("Usage: skillsgate core remove <name>"));
    process.exit(1);
  }

  const detected = await detectInstalledAgents();
  const linked = detected.length;

  if (!opts.yes) {
    const answer = await p.confirm({
      message: `Remove "${name}" from the core set and unlink it from up to ${linked} tool(s)?`,
      initialValue: false,
    });
    if (p.isCancel(answer) || !answer) {
      console.log(fmt.dim("  Cancelled."));
      return;
    }
  }

  const res = await removeCoreSkill(name);
  if (!res.ok) {
    console.error(fmt.error(`  ${res.error}`));
    process.exit(1);
  }

  console.log(
    fmt.success(`  Removed ${name} from core; unlinked from ${res.unlinked} tool(s).`),
  );
  if (res.residualCopies.length > 0) {
    console.log();
    console.log(fmt.warn("  Residual copies left in place (not deleted):"));
    for (const c of res.residualCopies) console.log(`    ${c}`);
  }
  console.log();
}

// ---------- core exclude / include ----------

async function runCoreExclude(
  opts: CoreOptions,
  excluded: boolean,
): Promise<void> {
  const [agentName, skill] = opts.positional;
  if (!agentName || !skill) {
    console.error(
      fmt.error(
        `Usage: skillsgate core ${excluded ? "exclude" : "include"} <agent> <skill>`,
      ),
    );
    process.exit(1);
  }
  if (!agents[agentName]) {
    console.error(fmt.error(`  Unknown tool: ${agentName}`));
    process.exit(1);
  }

  await setExclusion(agentName as AgentType, skill, excluded);

  const agent = agents[agentName];
  if (excluded) {
    console.log(
      fmt.success(`  ${agent.displayName} now opts out of ${skill}.`),
    );
    const res = await removeCoreSkillLinkOnly(agentName as AgentType, skill);
    if (res) console.log(fmt.dim(`  Unlinked existing copy from ${agent.displayName}.`));
  } else {
    console.log(fmt.success(`  ${agent.displayName} opts back into ${skill}.`));
    await runCoreSync({ ...opts, agent: [agentName], dryRun: false });
  }
}

/** Remove just the agent-side link for an excluded skill, without touching core. */
async function removeCoreSkillLinkOnly(
  agentName: AgentType,
  skill: string,
): Promise<boolean> {
  const agent = agents[agentName];
  if (!agent) return false;
  const target = path.join(agent.globalSkillsDir, skill);
  try {
    const lst = await fs.lstat(target);
    if (!lst.isSymbolicLink()) return false;
    const raw = await fs.readlink(target);
    const abs = path.resolve(path.dirname(target), raw);
    const coreDir = path.resolve(CORE_SKILLS_DIR());
    if (!abs.startsWith(coreDir + path.sep)) return false;
    await fs.unlink(target);
    return true;
  } catch {
    return false;
  }
}

// ---------- help ----------

export function printCoreHelp(): void {
  const BOLD = fmt.bold;
  const DIM = fmt.dim;
  console.log();
  console.log(`  ${BOLD("skillsgate core")} ${DIM("— manage the core skill set")}`);
  console.log();
  console.log(
    `  Core skills live in ${DIM("~/.agents/skills")} and are symlinked into every detected tool.`,
  );
  console.log();
  console.log(`  ${BOLD("Subcommands:")}`);
  console.log(`    list                     List core skills`);
  console.log(`    status                   Show per-tool fan-out gaps`);
  console.log(`    sync ${DIM("[--dry-run]")}          Reconcile links across detected tools`);
  console.log(`    add ${DIM("<name>")} ${DIM("[--from <agent>]")}  Promote an existing skill into core`);
  console.log(`    remove ${DIM("<name>")}             Remove from core and unlink everywhere`);
  console.log(`    exclude ${DIM("<agent> <skill>")}    Make one tool opt out of a core skill`);
  console.log(`    include ${DIM("<agent> <skill>")}    Undo an exclusion`);
  console.log();
  console.log(`  ${BOLD("Options:")}`);
  console.log(`    -a, --agent <id>         Limit to specific tool(s)`);
  console.log(`    -n, --dry-run            Show the plan without applying it`);
  console.log(`    -y, --yes                Skip confirmation prompts`);
  console.log(`    --json                   Machine-readable output`);
  console.log();
}

/** Used by `add` and the installer path when a skill is explicitly targeted at core. */
export async function addSkillToCore(
  name: string,
  sourceSkillMd: string,
): Promise<boolean> {
  const parsed = await parseSkillMd(sourceSkillMd);
  if (!parsed) return false;
  const res = await installSkillToCore(parsed);
  if (!res.ok) {
    console.error(fmt.error(`  ${res.error}`));
    return false;
  }
  await syncCore();
  return true;
}
