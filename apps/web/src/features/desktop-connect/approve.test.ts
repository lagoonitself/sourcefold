import { describe, expect, it } from "vitest";
import { buildCallbackTarget, isSameOriginRequest } from "./approve";

function post(headers: Record<string, string>) {
  return new Request("https://app.example.com/desktop/connect/approve", {
    method: "POST",
    headers,
  });
}

describe("isSameOriginRequest", () => {
  it("accepts a matching Origin", () => {
    expect(isSameOriginRequest(post({ origin: "https://app.example.com" }))).toBe(true);
  });

  it("rejects a different Origin even when Referer matches", () => {
    expect(
      isSameOriginRequest(
        post({ origin: "https://evil.example", referer: "https://app.example.com/x" }),
      ),
    ).toBe(false);
  });

  it("falls back to Referer when Origin is absent", () => {
    expect(
      isSameOriginRequest(post({ referer: "https://app.example.com/desktop/connect?a=1" })),
    ).toBe(true);
    expect(isSameOriginRequest(post({ referer: "https://evil.example/desktop/connect" }))).toBe(
      false,
    );
  });

  it("rejects when neither header is present or Referer is malformed", () => {
    expect(isSameOriginRequest(post({}))).toBe(false);
    expect(isSameOriginRequest(post({ referer: "not a url" }))).toBe(false);
  });
});

describe("buildCallbackTarget", () => {
  it("adds state, token and email to the loopback callback", () => {
    const url = new URL(
      buildCallbackTarget("http://127.0.0.1:4821/auth/callback", {
        state: "state-12345678",
        token: "sf_abc",
        email: "a@b.co",
      }),
    );
    expect(url.origin).toBe("http://127.0.0.1:4821");
    expect(url.pathname).toBe("/auth/callback");
    expect(url.searchParams.get("state")).toBe("state-12345678");
    expect(url.searchParams.get("token")).toBe("sf_abc");
    expect(url.searchParams.get("email")).toBe("a@b.co");
  });

  it("omits email when the user has none", () => {
    const url = new URL(
      buildCallbackTarget("http://127.0.0.1:4821/auth/callback", {
        state: "state-12345678",
        token: "sf_abc",
        email: null,
      }),
    );
    expect(url.searchParams.has("email")).toBe(false);
  });
});
