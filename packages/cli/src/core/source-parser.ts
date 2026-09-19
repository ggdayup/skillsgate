// Re-export shim.
//
// The implementation moved to `@skillsgate/skill-sources` so that the CLI and the
// desktop main process share a single parser instead of maintaining two that
// drift apart. This file stays where it was in order to preserve the existing
// `./core/source-parser.js` import surface:
//
//   - packages/cli/src/commands/{add,scan,update}.ts
//   - packages/cli/src/mcp/tools/{add,scan,update}.ts
//   - packages/tui/src/data/use-skill-actions.ts  (cross-package deep import)
//
// Portions adapted from vercel-labs/skills (https://github.com/vercel-labs/skills)
export {
  parseSource,
  getSourceLabel,
  getOwnerRepo,
  isRepoPrivate,
  SourceParseError,
} from "@skillsgate/skill-sources";
