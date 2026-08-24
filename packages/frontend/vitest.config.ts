import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Kept separate from vite.config.ts on purpose: that file configures the
// production bundle (manualChunks, dev server, proxy), none of which applies to
// a test run, and mixing the two makes a build regression easy to introduce by
// editing test settings.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
    // The repo carries both a pnpm and a Bun lockfile, so `react` can resolve
    // out of node_modules/.bun while `react-dom` comes from node_modules/.pnpm.
    // Two React copies means react-dom's hook dispatcher is null for any
    // component that resolved the other one (lucide-react hits this), so every
    // icon render throws. Vite's browser pipeline dedupes this for the app
    // build; Node resolution under test does not.
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Explicit imports from "vitest" instead of ambient globals, so test files
    // type-check under the same tsconfig as application code.
    globals: false,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.{test,spec}.{ts,tsx}", "src/test/**", "src/main.tsx"],
    },
  },
});
