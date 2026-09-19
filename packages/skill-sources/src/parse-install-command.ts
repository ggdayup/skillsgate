// Parse a pasted install command into the inputs the installer needs.
//
// The ecosystem-conventional way to install a skill is:
//
//     npx skills add humanlayer/skills --skill show-me
//
// Users copy that line out of a README. This module lets them paste it into
// SkillsGate and have SkillsGate do the install instead.
//
// INVARIANT — the pasted string is NEVER executed.
// It is a source descriptor, nothing more. We never spawn `npx`, never resolve
// a package from the npm registry, and never shell out. The grammar below is
// modelled on upstream vercel-labs/skills `parseAddOptions()` so that copied
// commands work verbatim, but the command text is only ever *read*.
//
// Scope note — grammar is upstream-shaped, reachability is not.
// Upstream `parseSource()` understands six source types (local, github, gitlab,
// git, download, well-known). SkillsGate can only install two of them (github,
// local). Rather than fail with a vague parse error on the other four, callers
// should surface `unsupportedSourceReason()`.

import { parseSource, SourceParseError } from "./source-parser";
import type { InstallMethod, ParsedSource } from "./types";

/** Scope the pasted command asked for. `unspecified` = no flag was present. */
export type RequestedScope = "global" | "project" | "unspecified";

export interface ParsedInstallCommand {
  /** Normalized source. Always github or local — see `unsupportedSourceReason()`. */
  source: ParsedSource;
  /**
   * Skill names the command asked for. Empty means "not specified" — the caller
   * should let the user pick from what `discoverSkills()` finds. `["*"]` = all.
   */
  skillFilter: string[];
  /** Agent names, already mapped to SkillsGate slugs. `["*"]` = all. */
  agents: string[];
  /**
   * Scope the command requested. Upstream treats "no flag" as project-local;
   * the desktop has no project concept, so callers there should treat
   * `unspecified` as global (see AGENTS.md, "Install command paste").
   */
  requestedScope: RequestedScope;
  method: InstallMethod | "unspecified";
  /** `--full-depth`: discover SKILL.md outside the standard container dirs. */
  fullDepth: boolean;
  /** `-l/--list`: resolve and show, do not install. */
  list: boolean;
  /** `-y/--yes`: use defaults for anything not specified. Never bypasses confirm. */
  yes: boolean;
  /**
   * Additional sources in the same command (`skills add a/b c/d`). SkillsGate
   * installs one source at a time; callers should surface these as "ignored".
   */
  extraSources: string[];
  /** Extra non-empty lines pasted alongside the command. Surfaced, not parsed. */
  extraLines: string[];
  /** Flags we recognized but do not act on, so the UI can be honest about it. */
  ignoredFlags: string[];
  /** True when the input actually looked like a `skills add` invocation. */
  wasCommand: boolean;
}

export type ParseInstallCommandResult =
  | { ok: true; value: ParsedInstallCommand }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Grammar tables (mirroring upstream)
// ---------------------------------------------------------------------------

/** Tokens that may legitimately precede the `skills` binary. */
const RUNNER_TOKENS = new Set([
  "npx",
  "bunx",
  "bun",
  "pnpm",
  "yarn",
  "npm",
  "deno",
  "dlx",
  "exec",
  "-y",
  "--yes",
  "--",
]);

/** `skills`, `skills@latest`, `skills@1.5.26` — any pinned form. */
const SKILLS_BIN = /^skills(?:@\S+)?$/;

/** Upstream aliases for the `add` subcommand. */
const ADD_ALIASES = new Set(["add", "a", "install", "i"]);

/** Other `skills` subcommands, so we can say *which* one we can't run. */
const OTHER_SUBCOMMANDS = new Set([
  "use",
  "remove",
  "rm",
  "r",
  "list",
  "ls",
  "find",
  "search",
  "f",
  "s",
  "update",
  "upgrade",
  "check",
  "init",
  "experimental_install",
  "experimental_sync",
]);

/**
 * Upstream agent slugs that differ from ours. Verified against upstream's
 * README agent table — only these four actually collide.
 * (Upstream `github-copilot`, `cursor`, `cline`, `opencode`, `trae`, … already
 * match our slugs exactly, so they need no entry.)
 */
export const UPSTREAM_AGENT_ALIASES: Record<string, string> = {
  codex: "codex-cli",
  droid: "droid-cli",
  kilo: "kilo-code",
  roo: "roo-code",
};

/** Map an upstream `--agent` slug onto our `AgentType`, leaving the rest alone. */
export function mapUpstreamAgentName(name: string): string {
  return UPSTREAM_AGENT_ALIASES[name] ?? name;
}

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

/**
 * Join backslash line-continuations, split remaining lines, strip shell
 * prompts. Only the first line is parsed as the command; the rest are reported
 * so a two-command paste can't silently merge into one.
 */
function normalizeInput(raw: string): { command: string; extraLines: string[] } {
  const joined = raw.replace(/\\\r?\n/g, " ");
  const lines = joined
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:\$|>|%|❯|PS>)\s+/, "").trim())
    .filter(Boolean);

  const [first, ...rest] = lines;
  return { command: first ?? "", extraLines: rest };
}

/** Split on whitespace, honouring single and double quotes. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const ch of input) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }

  if (started) tokens.push(current);
  return tokens;
}

/**
 * Locate the `skills add` invocation inside the token stream.
 * Returns the index of the first token after the subcommand, or null.
 * Throws when the input is a *different* `skills` subcommand — that deserves a
 * specific error rather than a vague "could not parse source".
 */
function locateCommand(tokens: string[]): number | null {
  const binIndex = tokens.findIndex((token) => SKILLS_BIN.test(token));
  if (binIndex < 0) return null;

  // Everything before the binary must be a runner (npx, pnpm dlx, …).
  const prefix = tokens.slice(0, binIndex);
  if (!prefix.every((token) => RUNNER_TOKENS.has(token))) return null;

  const subcommand = tokens[binIndex + 1];
  if (subcommand && ADD_ALIASES.has(subcommand)) return binIndex + 2;

  if (subcommand && OTHER_SUBCOMMANDS.has(subcommand)) {
    throw new SourceParseError(
      `That is the \`skills ${subcommand}\` command, not \`skills add\`. ` +
        `SkillsGate only reads install commands — paste an \`add\` command, ` +
        `or type the source directly (owner/repo).`,
    );
  }

  // `npx skills` with nothing useful after it.
  throw new SourceParseError(
    "That looks like a `skills` command but not an install one. " +
      "Expected: npx skills add <owner>/<repo> [--skill <name>]",
  );
}

/** Consume upstream's greedy, space-separated varargs. Returns the new index. */
function collectVarargs(tokens: string[], start: number, out: string[]): number {
  let i = start + 1;
  while (i < tokens.length && tokens[i] && !tokens[i]!.startsWith("-")) {
    out.push(tokens[i]!);
    i++;
  }
  return i - 1;
}

// ---------------------------------------------------------------------------
// Upstream-only source detection (so errors can be specific)
// ---------------------------------------------------------------------------

/**
 * Explain why a source upstream would accept is not installable here.
 * Returns null when the source is one we can handle.
 */
export function unsupportedSourceReason(input: string): string | null {
  const value = input.trim();

  if (/^gitlab:/i.test(value) || /gitlab\.com/i.test(value)) {
    return "GitLab sources are not supported yet. SkillsGate installs from GitHub and local paths.";
  }
  if (value.split("/").includes("_git")) {
    return "Azure Repos sources are not supported yet. SkillsGate installs from GitHub and local paths.";
  }
  if (/^git@|^ssh:\/\//i.test(value)) {
    return "Generic git/SSH sources are not supported yet. SkillsGate installs from GitHub and local paths.";
  }
  if (/\.(?:zip|tar|tgz|tar\.gz)$/i.test(value) || /codeload\.github\.com|raw\.githubusercontent\.com/i.test(value)) {
    return "Archive and direct-download sources are not supported yet. SkillsGate installs from GitHub and local paths.";
  }
  if (/^https?:\/\//i.test(value) && !/^https?:\/\/(?:www\.)?github\.com\//i.test(value)) {
    return "Only github.com URLs are supported. SkillsGate installs from GitHub and local paths.";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Command serialization (the inverse — used for the copyable hint)
// ---------------------------------------------------------------------------

/** Quote an argument only when it needs it (skill names may contain spaces). */
function quoteIfNeeded(value: string): string {
  return /^[A-Za-z0-9._/-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Build the canonical, copyable install command for a skill. Shares its shape
 * with the parser above, so the string we display always round-trips back
 * through `parseInstallCommand()`.
 */
export function formatInstallCommand(ownerRepo: string, skillName?: string): string {
  const base = `npx skills add ${ownerRepo}`;
  if (!skillName || skillName === "*") return base;
  return `${base} --skill ${quoteIfNeeded(skillName)}`;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export function parseInstallCommand(input: string): ParsedInstallCommand {
  const { command, extraLines } = normalizeInput(input);

  if (!command) {
    throw new SourceParseError("Nothing to parse — paste an install command or a source.");
  }

  const tokens = tokenize(command);
  const commandStart = locateCommand(tokens);
  const wasCommand = commandStart !== null;
  const body = wasCommand ? tokens.slice(commandStart) : tokens;

  const sources: string[] = [];
  const skillNames: string[] = [];
  const agentNames: string[] = [];
  const ignoredFlags: string[] = [];

  let global = false;
  let copy = false;
  let fullDepth = false;
  let list = false;
  let yes = false;
  let all = false;

  for (let i = 0; i < body.length; i++) {
    const token = body[i]!;

    if (token === "-g" || token === "--global") global = true;
    else if (token === "-y" || token === "--yes") yes = true;
    else if (token === "-l" || token === "--list") list = true;
    else if (token === "--all") all = true;
    else if (token === "--copy") copy = true;
    else if (token === "--full-depth") fullDepth = true;
    else if (token === "-s" || token === "--skill") i = collectVarargs(body, i, skillNames);
    else if (token === "-a" || token === "--agent") i = collectVarargs(body, i, agentNames);
    else if (token === "--metadata") {
      i++;
      ignoredFlags.push("--metadata");
    } else if (token === "--subagent") {
      i = collectVarargs(body, i, []);
      ignoredFlags.push("--subagent");
    } else if (token === "--json") ignoredFlags.push("--json");
    else if (token.startsWith("-")) ignoredFlags.push(token);
    else sources.push(token);
  }

  const [primary, ...extraSources] = sources;
  if (!primary) {
    throw new SourceParseError(
      "No source found. Expected: npx skills add <owner>/<repo> [--skill <name>]",
    );
  }

  const unsupported = unsupportedSourceReason(primary);
  if (unsupported) throw new SourceParseError(unsupported);

  const source = parseSource(primary);

  // `--all` is upstream shorthand for `--skill '*' --agent '*' -y`.
  if (all) {
    skillNames.length = 0;
    skillNames.push("*");
    agentNames.length = 0;
    agentNames.push("*");
    yes = true;
  }

  // Explicit `--skill` wins; otherwise fall back to the source's own `@skill`.
  const skillFilter =
    skillNames.length > 0 ? skillNames : source.skillFilter ? [source.skillFilter] : [];

  const agents =
    agentNames.length > 0 && agentNames[0] === "*"
      ? ["*"]
      : agentNames.map(mapUpstreamAgentName);

  return {
    source,
    skillFilter,
    agents,
    requestedScope: global ? "global" : "unspecified",
    method: copy ? "copy" : "unspecified",
    fullDepth,
    list,
    yes,
    extraSources,
    extraLines,
    ignoredFlags,
    wasCommand,
  };
}

/** Non-throwing wrapper for IPC handlers and UI call sites. */
export function tryParseInstallCommand(input: string): ParseInstallCommandResult {
  try {
    return { ok: true, value: parseInstallCommand(input) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
