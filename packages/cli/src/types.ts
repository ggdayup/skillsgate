// ---------- Agent Types ----------

export type AgentType =
  | "amp"
  | "antigravity"
  | "antigravity-ide"
  | "antigravity-cli"
  | "claude-code"
  | "cline"
  | "codebuddy"
  | "codebuddy-cn"
  | "codex-cli"
  | "droid-cli"
  | "ob-1"
  | "continue"
  | "cursor"
  | "github-copilot"
  | "goose"
  | "junie"
  | "kilo-code"
  | "opencode"
  | "openclaw"
  | "pear-ai"
  | "pi"
  | "roo-code"
  | "trae"
  | "trae-cn"
  | "workbuddy"
  | "workbuddy-ai"
  | "mercury"
  | "windsurf"
  | "zed"
  // Retained only so persisted data (e.g. lock `lastSelectedAgents`, caches) that
  // still references the old pseudo-agent keeps type-checking. It is no longer a
  // registered agent — `~/.agents/skills` is the core set, not an install target.
  | "universal";

export interface AgentConfig {
  name: AgentType;
  displayName: string;
  skillsDir: string;
  globalSkillsDir: string;
  detectInstalled: () => Promise<boolean>;
}

// ---------- Skill Types ----------

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  content: string;
  plugin?: string;
  metadata?: Record<string, unknown>;
}

// ---------- Source Parsing ----------

export type SourceType = "github" | "local";

export interface ParsedSource {
  type: SourceType;
  url: string;
  owner: string;
  repo: string;
  subpath?: string;
  ref?: string;
  skillFilter?: string;
  localPath?: string;
}

// ---------- Lock File ----------

export interface SkillLockEntry {
  source: string;
  sourceType: SourceType;
  originalUrl: string;
  skillFolderHash: string;
  installedAt: string;
  updatedAt: string;
}

export interface SkillLockFile {
  version: number;
  skills: Record<string, SkillLockEntry>;
  lastSelectedAgents?: AgentType[];
}

// ---------- Plugin Manifest Types ----------

export interface PluginManifest {
  name: string;
  skills?: string[];
  source?: string;
  description?: string;
}

export interface MarketplaceManifest {
  name?: string;
  plugins: PluginManifest[];
}

// ---------- Install Types ----------

export type InstallScope = "project" | "global";
export type InstallMethod = "symlink" | "copy";

export interface InstallResult {
  skillName: string;
  agent: AgentType;
  success: boolean;
  path: string;
  symlinkFailed?: boolean;
  error?: string;
}

// ---------- Core Skills Types ----------

/** Where a skill's source of truth lives. */
export type SkillRoot = "core" | "store";

export type CoreSyncAction =
  | "link" // create the agent-side symlink to a core skill
  | "unlink" // remove an agent-side symlink whose core skill is gone
  | "skip-conflict" // agent has a real dir of the same name; never overwrite
  | "skip-excluded" // agent opted out of this core skill
  | "skip-present"; // already correctly linked

export interface CoreSyncItem {
  skill: string;
  agent: AgentType;
  displayName: string;
  action: CoreSyncAction;
  /** Absolute path of the agent-side entry involved. */
  path: string;
  /** Human-readable detail for conflicts/exclusions. */
  reason?: string;
}

export interface CoreSyncPlan {
  items: CoreSyncItem[];
  /** Agents that were detected and are therefore in scope. */
  agents: AgentType[];
  /** Number of skills in the core set. */
  coreCount: number;
}

export interface CoreSyncResult {
  linked: number;
  unlinked: number;
  skippedConflicts: number;
  skippedExcluded: number;
  alreadyPresent: number;
  failed: { skill: string; agent: AgentType; error: string }[];
}

/** Persisted at ~/.agents/core.json — deliberately NOT in .skill-lock.json. */
export interface CoreConfig {
  version: number;
  /** agent id -> core skill names this agent opts out of */
  exclusions: Record<string, string[]>;
  storeDir: string;
}

export interface CoreStatusEntry {
  agent: AgentType;
  displayName: string;
  linked: number;
  missing: string[];
  conflicts: string[];
  excluded: string[];
  dangling: string[];
}

// ---------- Publish Types ----------

export interface PublishSkillMetadata {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ParsedSkill extends PublishSkillMetadata {
  content: string;
}

export interface SizeCheckResult {
  valid: boolean;
  totalSize: number;
  files: Array<{ name: string; size: number }>;
  errors: string[];
}

export interface DirectoryValidationResult {
  valid: boolean;
  skillName: string | null;
  errors: string[];
}

// ---------- Scan Types ----------

export type ScannerType = "claude-code" | "codex-cli" | "opencode" | "goose" | "aider";

export type SeverityLevel = "info" | "low" | "medium" | "high" | "critical";

export type RiskAssessment = "CLEAN" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ScannerConfig {
  name: ScannerType;
  displayName: string;
  binary: string;
  insideEnvVars: string[];
  buildArgs: (prompt: string) => string[];
  parseOutput: (stdout: string, stderr: string) => ScanReport | null;
}

export interface ScanFinding {
  file: string;
  line?: number;
  severity: SeverityLevel;
  category: string;
  description: string;
}

export interface ScanReport {
  risk: RiskAssessment;
  findings: ScanFinding[];
  summary: string;
  raw?: string;
}

export interface InvocationResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface ScanSummary {
  sourceId: string;
  totalScans: number;
  riskBreakdown: Record<RiskAssessment, number>;
  topFindings: { category: string; count: number; avgSeverity: string }[];
  lastScannedAt: string | null;
}
