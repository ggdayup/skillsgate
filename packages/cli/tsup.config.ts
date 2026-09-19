import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/core/agents.ts",
    "src/core/installer.ts",
    "src/core/skill-discovery.ts",
    "src/core/skill-lock.ts",
    "src/core/source-parser.ts",
    "src/core/git.ts",
    "src/core/skills-sh-client.ts",
    "src/utils/auth-store.ts",
    "src/constants.ts",
    "src/types.ts",
  ],
  format: ["esm"],
  outDir: "dist",
  target: "node18",
  platform: "node",
  splitting: true,
  sourcemap: true,
  dts: false,
  clean: true,
  banner: {},
  external: [
    "@napi-rs/keyring",
  ],
  // `@skillsgate/skill-sources` is a source-only workspace package: its `exports`
  // points straight at `.ts` with no build step, and it is listed under
  // devDependencies so it is never published. tsup must therefore inline it into
  // dist instead of leaving a bare `import` that would fail at runtime.
  noExternal: ["@skillsgate/skill-sources"],
  shims: true,
});
