import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Sourcefold",
    description:
      "Save web pages, YouTube transcripts, Reddit, Hacker News, Bluesky, Substack, Grokipedia and X posts to your Sourcefold folders.",
    version: "0.4.0",
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAozJcixp3JSIVwGmPY6WuKzVUiMzNm0lsMdQXKzAPGk2j3gjxVTC/rZkYlxwrCxlkUfx/UJn89C1OBDpKxM1evVQGY2jqu/0cFhl/ymLcBQX6jXkWwI+FasbXoAWdu5LdLUIw4gkkcgwb1uzLEAsKejrTq5gdFiW4X73ZWuPhpmdQ3mdbWDiMSw9hks7u78FiOx1MnZmMkSZdDqdGxeWLgtIdsblaK8LkcUF/g+yBwoSy8lq6VMnJQ8jEgtFIgsamBL+hKbDKTefLucMxDTIEcNslE4al/oKfMgf7ZIzo20Nt9XV2NVB/7ROn32u9bHkxtlZv4vrqk/oJd1uxCZym8QIDAQAB",
    permissions: [
      "storage",
      "activeTab",
      "scripting",
      "contextMenus",
      "alarms",
      "nativeMessaging",
      "identity",
    ],
    // The account (Supabase, Google Drive) and what the background fetches to save: Grokipedia
    // articles, and the pictures in X and Substack posts it copies into Drive.
    host_permissions: [
      "http://127.0.0.1:23456/*",
      "https://*.supabase.co/*",
      "https://www.googleapis.com/*",
      "https://grokipedia.com/*",
      "https://cdn.syndication.twimg.com/*",
      "https://api.fxtwitter.com/*",
      "https://pbs.twimg.com/*",
      "https://video.twimg.com/*",
      "https://substackcdn.com/*",
      "https://substack-post-media.s3.amazonaws.com/*",
    ],
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
