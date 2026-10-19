import type { WebApi } from "../web-api";

// Saves the library's changes to Google Drive in the background after Claude changes something,
// so a crash or a closed laptop doesn't leave hundreds of changes unsaved. Contract:
// docs/dev/handoff-run-fixes.md, package C. Stub: package C fills it in.

/** Asks for a background Drive save soon. Cheap to call often; never throws. */
export function scheduleDriveSave(_api: WebApi): void {}
