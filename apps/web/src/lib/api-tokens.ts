import "server-only";
import { createHash, randomBytes } from "node:crypto";

export const API_TOKEN_PREFIX = "sf_";

export function generateApiToken(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
