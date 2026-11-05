import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { appDataDir } from "./config";
import { createDesktopBridge } from "./desktop-bridge";
import { createServer, VERSION } from "./index";
import { ADD_JOBS_FILE, fileJobStore } from "./tools/add-jobs";
import { createLocalFetch } from "./local-api";
import { createWebApi } from "./web-api";

process.on("unhandledRejection", (err) => {
  console.error("[sourcefold] unhandled rejection:", err);
});

// The bundle's entry point: Claude Desktop runs `node server/index.js`, built from this file.
// Add jobs are kept on disk so they carry on after Claude Desktop restarts the server.
const desktop = createDesktopBridge();
const server = createServer(
  {
    api: createWebApi({
      localFetch: createLocalFetch({ onChanged: () => void desktop.changed() }),
    }),
    desktop,
  },
  { jobStore: fileJobStore(join(appDataDir(), ADD_JOBS_FILE)) },
);
server
  .connect(new StdioServerTransport())
  .then(() => console.error(`[sourcefold] MCP server ${VERSION} ready`))
  .catch((err) => {
    console.error("[sourcefold] failed to start:", err);
    process.exit(1);
  });
