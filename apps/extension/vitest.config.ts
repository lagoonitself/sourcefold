import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "wxt/browser": resolve(__dirname, "./lib/__mocks__/wxt-browser.ts"),
    },
  },
});
