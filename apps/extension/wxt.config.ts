import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Sourcefold",
    description: "Save Grokipedia, Substack and X pages to your Sourcefold folders.",
    version: "0.1.0",
    permissions: ["storage", "activeTab", "scripting", "contextMenus"],
    host_permissions: ["http://localhost:3000/*", "https://*.vercel.app/*"],
    action: {
      default_title: "Sourcefold",
    },
    options_ui: {
      open_in_tab: true,
    },
  },
});
