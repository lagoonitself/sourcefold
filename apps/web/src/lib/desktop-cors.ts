// The desktop app's webview calls /api/* from its own origin with a Bearer token, so the
// browser needs CORS headers. Only the Tauri webview origins are allowed, and never cookies.
const DESKTOP_ORIGINS = new Set([
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
]);

export function desktopCorsHeaders(origin: string | null): Record<string, string> | null {
  if (!origin || !DESKTOP_ORIGINS.has(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
