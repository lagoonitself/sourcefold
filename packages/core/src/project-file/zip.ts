// Writing and reading the `.sourcefold` zip (docs/PROJECT-FILE.md). Runs in the browser and the
// desktop's webview; the offline desktop app has its own Rust version of the same rules.

import { Zip, ZipDeflate, ZipPassThrough, unzipSync, strToU8, strFromU8 } from "fflate";
import {
  MANIFEST_PATH,
  PROJECT_FILE_LIMITS,
  ProjectFileError,
  parseProjectManifest,
  type ProjectFileManifest,
} from "./manifest";
import { extensionOf, isSafeEntryPath, projectFileMediaType } from "./paths";

// Already-compressed media is stored as is; text is deflated.
const STORED_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "mp4"]);

/**
 * Builds a project file entry by entry, so a big project never sits in memory twice. Add the
 * files, then `finish` with the manifest; the chunks make a Blob (`new Blob(chunks)`) or a file.
 */
export class ProjectFileWriter {
  private readonly chunks: Uint8Array[] = [];
  private readonly zip: Zip;
  private readonly paths = new Set<string>();
  private failure: Error | null = null;
  private done: Promise<Uint8Array[]>;
  private bytes = 0;

  constructor() {
    let resolve!: (chunks: Uint8Array[]) => void;
    let reject!: (err: Error) => void;
    this.done = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.zip = new Zip((err, chunk, final) => {
      if (err) {
        this.failure = err;
        reject(err);
        return;
      }
      this.chunks.push(chunk);
      this.bytes += chunk.byteLength;
      if (final) resolve(this.chunks);
    });
  }

  /** Bytes written so far. */
  get size(): number {
    return this.bytes;
  }

  add(path: string, content: Uint8Array | string): void {
    if (this.failure) throw this.failure;
    if (path === MANIFEST_PATH || !isSafeEntryPath(path)) {
      throw new ProjectFileError(`Can't add "${path}" to a project file.`);
    }
    if (this.paths.has(path.toLowerCase())) {
      throw new ProjectFileError(`"${path}" is already in the project file.`);
    }
    this.paths.add(path.toLowerCase());
    this.push(path, typeof content === "string" ? strToU8(content) : content);
  }

  has(path: string): boolean {
    return this.paths.has(path.toLowerCase());
  }

  async finish(manifest: ProjectFileManifest): Promise<Uint8Array[]> {
    if (this.failure) throw this.failure;
    this.push(MANIFEST_PATH, strToU8(`${JSON.stringify(manifest, null, 2)}\n`));
    this.zip.end();
    return this.done;
  }

  private push(path: string, data: Uint8Array): void {
    const entry = STORED_EXTENSIONS.has(extensionOf(path))
      ? new ZipPassThrough(path)
      : new ZipDeflate(path, { level: 6 });
    this.zip.add(entry);
    entry.push(data, true);
  }
}

export interface ProjectFileContents {
  manifest: ProjectFileManifest;
  /** Every file except the manifest, by its path in the zip. */
  entries: Map<string, Uint8Array>;
  /** Unpacked size of everything, for "38 MB" in the preview. */
  bytes: number;
}

/**
 * Opens a project file someone sent. Refuses anything unsafe before unpacking it: too big, too
 * many entries, paths that climb out of the folder, file types other than Markdown, images and
 * mp4. Then checks the manifest and that every path it names is in the zip.
 */
export function readProjectFile(file: Uint8Array): ProjectFileContents {
  if (file.byteLength > PROJECT_FILE_LIMITS.fileBytes) {
    throw new ProjectFileError("This project file is too big to open (over 2 GB).");
  }
  if (file.byteLength < 4 || file[0] !== 0x50 || file[1] !== 0x4b) {
    throw new ProjectFileError("This isn't a Sourcefold project file.");
  }

  let count = 0;
  let total = 0;
  let unsafe: string | null = null;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(file, {
      filter(entry) {
        if (entry.name.endsWith("/")) return false;
        count += 1;
        total += entry.originalSize;
        if (count > PROJECT_FILE_LIMITS.entries) {
          throw new ProjectFileError("This project file has too many files in it.");
        }
        if (total > PROJECT_FILE_LIMITS.unpackedBytes) {
          throw new ProjectFileError("This project file is too big to open (over 4 GB unpacked).");
        }
        const limit =
          entry.name === MANIFEST_PATH
            ? PROJECT_FILE_LIMITS.manifestBytes
            : PROJECT_FILE_LIMITS.entryBytes;
        if (entry.originalSize > limit) {
          throw new ProjectFileError(`"${entry.name}" in this project file is too big.`);
        }
        if (entry.name !== MANIFEST_PATH) {
          if (!isSafeEntryPath(entry.name) || projectFileMediaType(entry.name) === null) {
            unsafe ??= entry.name;
            return false;
          }
        }
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ProjectFileError) throw err;
    throw new ProjectFileError("This project file is damaged and can't be opened.");
  }
  if (unsafe !== null) {
    throw new ProjectFileError(
      `This project file has a file Sourcefold won't open ("${unsafe}"). Only Markdown, images and mp4 are allowed.`,
    );
  }

  const manifestBytes = raw[MANIFEST_PATH];
  if (!manifestBytes) throw new ProjectFileError("This isn't a Sourcefold project file.");
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(manifestBytes));
  } catch {
    throw new ProjectFileError("This project file is damaged: its sourcefold.json can't be read.");
  }
  const manifest = parseProjectManifest(json);

  const entries = new Map<string, Uint8Array>();
  let bytes = manifestBytes.byteLength;
  for (const [path, data] of Object.entries(raw)) {
    if (path === MANIFEST_PATH) continue;
    entries.set(path, data);
    bytes += data.byteLength;
  }

  for (const source of manifest.sources) {
    if (source.file !== null && !entries.has(source.file)) {
      throw new ProjectFileError(`This project file is damaged: "${source.file}" is missing.`);
    }
    if (source.media_folder !== null && !isSafeEntryPath(source.media_folder)) {
      throw new ProjectFileError(
        `This project file is damaged: "${source.media_folder}" isn't allowed.`,
      );
    }
  }

  return { manifest, entries, bytes };
}

/** The files in a source's `<name>_files/` folder (not in subfolders), by file name. */
export function mediaInFolder(
  entries: ReadonlyMap<string, Uint8Array>,
  folder: string | null,
): { name: string; data: Uint8Array }[] {
  if (folder === null) return [];
  const prefix = `${folder}/`;
  const out: { name: string; data: Uint8Array }[] = [];
  for (const [path, data] of entries) {
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    if (name.includes("/")) continue;
    out.push({ name, data });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function textOf(data: Uint8Array): string {
  return strFromU8(data);
}
