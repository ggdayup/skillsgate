// Shared source-descriptor layer.
//
// Source-only package (no build step) — `exports` points straight at this file,
// and the consuming bundler compiles the TypeScript. Same shape as
// `packages/ui`, which the desktop renderer consumes the same way.
//
// Consumed by:
//   - packages/cli          (bundled by tsup; listed in `noExternal`)
//   - apps/desktop main     (bundled by electron-vite; listed in
//                            `externalizeDepsPlugin({ exclude })` so it is NOT
//                            turned into a runtime require, which would fail
//                            because this package is ESM and main is CJS)

// Types
export type { SourceType, ParsedSource, InstallMethod } from "./types";

// Source parsing
export {
  parseSource,
  getSourceLabel,
  getOwnerRepo,
  isRepoPrivate,
  SourceParseError,
} from "./source-parser";

// Install-command parsing (the pasted `npx skills add …` form)
export {
  parseInstallCommand,
  tryParseInstallCommand,
  unsupportedSourceReason,
  mapUpstreamAgentName,
  formatInstallCommand,
  UPSTREAM_AGENT_ALIASES,
} from "./parse-install-command";

export type {
  ParsedInstallCommand,
  ParseInstallCommandResult,
  RequestedScope,
} from "./parse-install-command";
