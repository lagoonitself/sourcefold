import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createDesktopBridge } from "./desktop-bridge";
import { createServer, VERSION } from "./index";
import { createWebApi } from "./web-api";

// The bundle's entry point: Claude Desktop runs `node server/index.js`, built from this file.
const server = createServer({ api: createWebApi(), desktop: createDesktopBridge() });
server
  .connect(new StdioServerTransport())
  .then(() => console.error(`[sourcefold] MCP server ${VERSION} ready`))
  .catch((err) => {
    console.error("[sourcefold] failed to start:", err);
    process.exit(1);
  });
