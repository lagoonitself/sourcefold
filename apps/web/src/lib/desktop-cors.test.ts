import { describe, expect, it } from "vitest";
import { desktopCorsHeaders } from "./desktop-cors";

describe("desktopCorsHeaders", () => {
  it("allows the Tauri webview origins and echoes the origin", () => {
    for (const origin of [
      "http://tauri.localhost",
      "https://tauri.localhost",
      "tauri://localhost",
    ]) {
      const headers = desktopCorsHeaders(origin);
      expect(headers?.["Access-Control-Allow-Origin"]).toBe(origin);
      expect(headers?.["Access-Control-Allow-Headers"]).toContain("Authorization");
      expect(headers).not.toHaveProperty("Access-Control-Allow-Credentials");
    }
  });

  it("gives other origins nothing", () => {
    expect(desktopCorsHeaders(null)).toBeNull();
    expect(desktopCorsHeaders("https://evil.example")).toBeNull();
    expect(desktopCorsHeaders("http://localhost:3000")).toBeNull();
  });
});
