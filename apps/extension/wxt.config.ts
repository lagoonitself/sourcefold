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
    optional_host_permissions: ["https://*/*", "http://*/*"],
    action: {
      default_title: "Sourcefold",
    },
    options_ui: {
      open_in_tab: true,
    },
    commands: {
      _execute_action: {
        suggested_key: {
          default: "Alt+Shift+S",
        },
        description: "Open Sourcefold",
      },
    },
  },
});
