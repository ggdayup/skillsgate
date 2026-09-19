// Source-descriptor vocabulary, shared by the CLI and the desktop main process.
//
// These types used to live in `packages/cli/src/types.ts`, which the desktop
// cannot import (the CLI is ESM with `.js` import extensions, and the desktop's
// main process builds as CJS with `externalizeDepsPlugin()` turning its
// dependencies into runtime `require()` calls). `packages/cli/src/types.ts`
// re-exports them so every existing import path keeps working.

/** Where a skill's source lives. */
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

/** How a skill is placed into an agent's skills directory. */
export type InstallMethod = "symlink" | "copy";
