// Builds the Claude Desktop extension: one bundled server file plus pdf.js, the manifest and the
// icon, packed as dist/Sourcefold-Claude.mcpb (docs/dev/handoff-mcp.md).
//
// pdf.js stays outside the bundle: in Node it loads its worker from the file next to its own
// module, which a bundle would break. Both files are copied in as a tiny node_modules.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const out = join(root, "dist", "bundle");
const require = createRequire(import.meta.url);

// The extension's version follows the desktop app's, so both ship from the same release tag.
const version = JSON.parse(readFileSync(join(repo, "apps/desktop/package.json"), "utf8")).version;
const defaultWebUrl = (process.env.SOURCEFOLD_WEB_URL ?? "").trim();

rmSync(join(root, "dist"), { recursive: true, force: true });
mkdirSync(join(out, "server"), { recursive: true });

await build({
  entryPoints: [join(root, "src/main.ts")],
  outfile: join(out, "server/index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  external: ["pdfjs-dist", "pdfjs-dist/*", "@napi-rs/canvas", "canvas"],
  // Some dependencies still call require(); give the ES module one.
  banner: {
    js: 'import { createRequire as __sfCreateRequire } from "node:module"; const require = __sfCreateRequire(import.meta.url);',
  },
  define: {
    __SOURCEFOLD_VERSION__: JSON.stringify(version),
    __SOURCEFOLD_DEFAULT_WEB_URL__: JSON.stringify(defaultWebUrl),
  },
  legalComments: "none",
  logLevel: "warning",
});

const pdfjsDir = dirname(require.resolve("pdfjs-dist/package.json"));
const pdfjsOut = join(out, "node_modules/pdfjs-dist");
mkdirSync(join(pdfjsOut, "legacy/build"), { recursive: true });
for (const file of ["pdf.mjs", "pdf.worker.mjs"]) {
  cpSync(join(pdfjsDir, "legacy/build", file), join(pdfjsOut, "legacy/build", file));
}
const pdfjsPackage = JSON.parse(readFileSync(join(pdfjsDir, "package.json"), "utf8"));
writeFileSync(
  join(pdfjsOut, "package.json"),
  JSON.stringify({ name: "pdfjs-dist", version: pdfjsPackage.version, type: "module" }, null, 2),
);
cpSync(join(pdfjsDir, "LICENSE"), join(pdfjsOut, "LICENSE"));

// Start the built server once, as Claude Desktop will, and list its tools into the manifest. This
// also proves the bundle runs. No sign-in is needed to list tools.
const client = new Client({ name: "sourcefold-build", version });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [join(out, "server/index.mjs")],
    env: { PATH: process.env.PATH ?? "", LOCALAPPDATA: join(root, "dist", "no-app-data") },
    stderr: "ignore",
  }),
);
const { tools } = await client.listTools();
await client.close();
if (tools.length === 0) throw new Error("The built server lists no tools.");

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
manifest.version = version;
manifest.tools = tools.map((t) => ({
  name: t.name,
  description: (t.description ?? "").split("\n")[0].split(/(?<=\.)\s/)[0],
}));
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(join(repo, "apps/desktop/src-tauri/icons/icon.png"), join(out, "icon.png"));
cpSync(join(repo, "LICENSE"), join(out, "LICENSE"));

const mcpb = join(repo, "node_modules/@anthropic-ai/mcpb/dist/cli/cli.js");
execFileSync(process.execPath, [mcpb, "pack", out, join(root, "dist", "Sourcefold-Claude.mcpb")], {
  stdio: "inherit",
});
console.log(`Built apps/mcp/dist/Sourcefold-Claude.mcpb (version ${version})`);
