import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"

// `@skillsgate/skill-sources` is a source-only workspace package: `exports` points
// straight at `.ts`, and it has no build step. The main process compiles to CJS, so
// if externalizeDepsPlugin turned it into a runtime `require()` the app would throw
// ERR_REQUIRE_ESM at launch. Excluding it here forces the bundler to inline the
// source. It also sits in devDependencies — externalizeDepsPlugin only externalizes
// `dependencies`, so that is the primary guard and this is the explicit one.
const bundledWorkspacePackages = ["@skillsgate/skill-sources"]

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspacePackages })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspacePackages })],
  },
  renderer: {
    plugins: [react()],
  },
})
