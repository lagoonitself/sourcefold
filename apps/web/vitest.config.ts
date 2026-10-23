import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The guard throws outside a Next.js server build; route tests load server modules.
      "server-only": path.resolve(__dirname, "./src/test/server-only.ts"),
    },
  },
});
