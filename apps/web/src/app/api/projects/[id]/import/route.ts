import { z } from "zod";
import { jsonData, jsonError, requireApiUser } from "@/lib/api";
import { pushToDriveSoon } from "@/features/drive/push-to-drive-soon";
import { ImportError, importBatch } from "@/features/project-file/import-project";
import { IMPORT_MAX_BODY_BYTES, importRequestSchema } from "@/features/project-file/import-schema";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Adds one batch of a project file to a new project. `{id}` is the new project's id, made by the
// client; the first call (with `project`) creates it. See docs/PROJECT-FILE.md.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiUser(request);
  if ("response" in auth) return auth.response;
  const { db, userId } = auth;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return jsonError(400, "Invalid project ID.");

  const tooBig = () => jsonError(413, "This part of the project file is too big to send.");
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > IMPORT_MAX_BODY_BYTES) return tooBig();
  const text = await request.text();
  if (Buffer.byteLength(text) > IMPORT_MAX_BODY_BYTES) return tooBig();

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }
  const parsed = importRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, parsed.error.issues[0]?.message ?? "Invalid request body.");
  }

  try {
    const result = await importBatch(db, userId, id, parsed.data);
    if (result.done) pushToDriveSoon(userId);
    return jsonData({ name: result.name });
  } catch (err) {
    if (err instanceof ImportError) return jsonError(err.status, err.message);
    console.error("Failed to import a project file batch:", err);
    return jsonError(500, "Couldn't save the project. Try again.");
  }
}
