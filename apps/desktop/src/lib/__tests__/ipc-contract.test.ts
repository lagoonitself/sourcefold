import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keeps the React side and the Rust side of the IPC in sync. It reads the Rust sources as text
 * (regexes tuned to this repo's code style, not a Rust parser) and the TypeScript sources as text,
 * then checks every `tauriInvoke("command", { args })` call against the registered commands.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../..");
const rustDir = path.resolve(srcDir, "../src-tauri/src");

interface CommandParam {
  name: string; // camelCase key the JS side must use
  required: boolean;
}

type CommandRegistry = Map<string, CommandParam[]>;

const INJECTED_TYPES = /^(?:tauri::)?(?:State<|AppHandle\b|Window\b|WebviewWindow\b|Webview\b)/;

function snakeToCamel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Splits on commas that are not nested inside <>, () or {}. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "<" || ch === "(" || ch === "{" || ch === "[") depth++;
    if (ch === ">" || ch === ")" || ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function stripRustComments(source: string): string {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

export function parseRustCommands(source: string): CommandRegistry {
  const commands: CommandRegistry = new Map();
  const code = stripRustComments(source);
  const pattern =
    /#\[tauri::command\]\s*pub\s+(?:async\s+)?fn\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:->|\{)/g;
  for (const match of code.matchAll(pattern)) {
    const [, fnName, rawParams] = match;
    const params: CommandParam[] = [];
    for (const raw of splitTopLevel(rawParams)) {
      const colon = raw.indexOf(":");
      if (colon === -1) throw new Error(`Cannot parse parameter "${raw}" of ${fnName}`);
      const name = raw
        .slice(0, colon)
        .trim()
        .replace(/^mut\s+/, "");
      const type = raw.slice(colon + 1).trim();
      if (INJECTED_TYPES.test(type)) continue;
      params.push({ name: snakeToCamel(name), required: !/^Option\s*</.test(type) });
    }
    commands.set(fnName, params);
  }
  return commands;
}

export function parseRegisteredNames(mainSource: string): string[] {
  const code = stripRustComments(mainSource);
  const block = code.match(/generate_handler!\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error("generate_handler![...] not found in main.rs");
  return splitTopLevel(block[1]).map((entry) => {
    const name = entry.match(/^(?:[\w:]+::)?(\w+)$/);
    if (!name) throw new Error(`Cannot parse generate_handler entry "${entry}"`);
    return name[1];
  });
}

export interface InvokeCall {
  file: string;
  command: string;
  keys: string[];
  usesObjectLiteral: boolean;
}

export function extractInvokeCalls(file: string, source: string): InvokeCall[] {
  const calls: InvokeCall[] = [];
  const pattern =
    /\btauriInvoke(?:<[^(]*?>)?\(\s*["'`](\w+)["'`]\s*(?:,\s*([\s\S]*?))?\)\s*(?:;|\)|,|\n|$)/g;
  for (const match of source.matchAll(pattern)) {
    const [, command, rawArgs] = match;
    if (rawArgs === undefined || rawArgs.trim() === "") {
      calls.push({ file, command, keys: [], usesObjectLiteral: true });
      continue;
    }
    const args = rawArgs.trim().replace(/,$/, "");
    if (!args.startsWith("{") || !args.endsWith("}")) {
      calls.push({ file, command, keys: [], usesObjectLiteral: false });
      continue;
    }
    const inner = args.slice(1, -1).replace(/\/\/[^\n]*/g, "");
    const keys = splitTopLevel(inner).map((entry) => {
      if (entry.startsWith("...")) return entry; // reported as an unknown key
      const key = entry.match(/^["']?([A-Za-z_$][\w$]*)["']?\s*(?::|$)/);
      return key ? key[1] : entry;
    });
    calls.push({ file, command, keys, usesObjectLiteral: true });
  }
  return calls;
}

export function checkCalls(
  registered: string[],
  registry: CommandRegistry,
  calls: InvokeCall[],
): string[] {
  const problems: string[] = [];

  for (const name of registered) {
    if (!registry.has(name))
      problems.push(`registered command "${name}" has no #[tauri::command] fn`);
  }
  for (const name of registry.keys()) {
    if (!registered.includes(name)) {
      problems.push(`#[tauri::command] fn "${name}" is not in generate_handler!`);
    }
  }

  for (const call of calls) {
    const where = `${call.file}: tauriInvoke("${call.command}")`;
    if (!registered.includes(call.command)) {
      problems.push(`${where} calls a command that is not registered in main.rs`);
      continue;
    }
    const params = registry.get(call.command) ?? [];
    if (!call.usesObjectLiteral) {
      problems.push(`${where} must pass an object literal so its keys can be checked`);
      continue;
    }
    for (const key of call.keys) {
      if (!params.some((p) => p.name === key)) {
        const expected = params.map((p) => p.name).join(", ") || "(no arguments)";
        problems.push(`${where} passes unknown argument "${key}"; Rust expects: ${expected}`);
      }
    }
    for (const param of params) {
      if (param.required && !call.keys.includes(param.name)) {
        problems.push(`${where} is missing required argument "${param.name}"`);
      }
    }
  }
  return problems;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function loadRealRegistry(): { registered: string[]; registry: CommandRegistry } {
  const registered = parseRegisteredNames(readFileSync(path.join(rustDir, "main.rs"), "utf8"));
  const registry: CommandRegistry = new Map();
  const commandsDir = path.join(rustDir, "commands");
  for (const file of readdirSync(commandsDir).filter((f) => f.endsWith(".rs"))) {
    const parsed = parseRustCommands(readFileSync(path.join(commandsDir, file), "utf8"));
    for (const [name, params] of parsed) registry.set(name, params);
  }
  return { registered, registry };
}

describe("IPC contract: tauriInvoke calls match the Rust commands", () => {
  it("every call uses a registered command with the right argument keys", () => {
    const { registered, registry } = loadRealRegistry();
    const calls = walk(srcDir).flatMap((file) =>
      extractInvokeCalls(path.relative(srcDir, file), readFileSync(file, "utf8")),
    );

    // Guards against the regexes silently matching nothing after a refactor.
    expect(registered.length).toBeGreaterThan(20);
    expect(calls.length).toBeGreaterThan(20);

    expect(checkCalls(registered, registry, calls)).toEqual([]);
  });

  it("parses the parameters of the commands the earlier mismatches were about", () => {
    const { registry } = loadRealRegistry();
    expect(registry.get("set_offline_mode")).toEqual([{ name: "offline", required: true }]);
    expect(registry.get("start_sign_in")).toEqual([{ name: "webUrl", required: true }]);
    expect(registry.get("get_item")).toEqual([{ name: "id", required: true }]);
    expect(registry.get("get_session")).toEqual([]);
    expect(registry.get("move_folder")).toEqual([
      { name: "id", required: true },
      { name: "parentId", required: false },
      { name: "position", required: true },
    ]);
  });
});

describe("IPC contract checker", () => {
  const registry: CommandRegistry = new Map([
    [
      "rename_item",
      [
        { name: "id", required: true },
        { name: "title", required: true },
      ],
    ],
    ["get_folders", [{ name: "includeArchived", required: false }]],
  ]);
  const registered = ["rename_item", "get_folders"];
  const check = (source: string) =>
    checkCalls(registered, registry, extractInvokeCalls("x.ts", source));

  it("accepts correct calls", () => {
    expect(check(`tauriInvoke<void>("rename_item", { id, title });`)).toEqual([]);
    expect(check(`tauriInvoke<Folder[]>("get_folders");`)).toEqual([]);
    expect(
      check(`return await tauriInvoke<Folder[]>("get_folders", { includeArchived });`),
    ).toEqual([]);
  });

  it("flags an unregistered command", () => {
    expect(check(`tauriInvoke("nope", { id });`)).toEqual([
      expect.stringContaining('tauriInvoke("nope") calls a command that is not registered'),
    ]);
  });

  it("flags snake_case keys and wrong names", () => {
    const problems = check(`tauriInvoke("rename_item", { id, title, folder_id: x });`);
    expect(problems).toEqual([expect.stringContaining('unknown argument "folder_id"')]);
  });

  it("flags a missing required argument", () => {
    expect(check(`tauriInvoke("rename_item", { id });`)).toEqual([
      expect.stringContaining('missing required argument "title"'),
    ]);
  });

  it("flags commands registered without a fn and fns that are not registered", () => {
    const problems = checkCalls(["ghost"], registry, []);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"ghost" has no #[tauri::command] fn'),
        expect.stringContaining('"rename_item" is not in generate_handler!'),
      ]),
    );
  });

  it("requires an object literal for arguments", () => {
    expect(check(`tauriInvoke("rename_item", args);`)).toEqual([
      expect.stringContaining("must pass an object literal"),
    ]);
  });
});
