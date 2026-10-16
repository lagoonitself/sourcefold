import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { SourceError } from "@sourcefold/core";
import { desktopSourceFetch } from "@/lib/web-fetch";

// What the Rust `web_fetch` command returns (see `WebFetchResponse` in src-tauri/src/web_fetch.rs).
const textResponse = {
  status: 200,
  url: "https://example.com/final",
  headers: { "content-type": "text/html" },
  text: "<html>ok</html>",
};

describe("desktopSourceFetch", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls web_fetch with the request fields and maps the response", async () => {
    invokeMock.mockResolvedValue(textResponse);

    const response = await desktopSourceFetch({
      url: "https://example.com/",
      method: "POST",
      headers: { accept: "text/html", "content-type": "application/json" },
      body: '{"a":1}',
    });

    expect(invokeMock).toHaveBeenCalledWith("web_fetch", {
      url: "https://example.com/",
      method: "POST",
      headers: { accept: "text/html", "content-type": "application/json" },
      body: '{"a":1}',
      responseType: "text",
    });
    expect(response).toEqual({
      status: 200,
      url: "https://example.com/final",
      headers: { "content-type": "text/html" },
      text: "<html>ok</html>",
    });
    expect(response.bytes).toBeUndefined();
  });

  it("defaults to GET with a text response and no body", async () => {
    invokeMock.mockResolvedValue(textResponse);

    await desktopSourceFetch({ url: "https://example.com/" });

    expect(invokeMock).toHaveBeenCalledWith("web_fetch", {
      url: "https://example.com/",
      method: "GET",
      headers: {},
      body: null,
      responseType: "text",
    });
  });

  it("decodes base64 bytes into a Uint8Array", async () => {
    invokeMock.mockResolvedValue({
      status: 200,
      url: "https://example.com/file.pdf",
      headers: { "content-type": "application/pdf" },
      text: "",
      bytes: "aGVsbG8=",
    });

    const response = await desktopSourceFetch({
      url: "https://example.com/file.pdf",
      responseType: "bytes",
    });

    expect(invokeMock).toHaveBeenCalledWith("web_fetch", {
      url: "https://example.com/file.pdf",
      method: "GET",
      headers: {},
      body: null,
      responseType: "bytes",
    });
    expect(response.text).toBe("");
    expect(response.bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(response.bytes ?? [])).toEqual([104, 101, 108, 108, 111]);
  });

  it.each([
    ["invalid_url: bad", "invalid_url", "That link can't be opened."],
    [
      "blocked_address",
      "blocked",
      "Sourcefold doesn't open links to this computer or your local network.",
    ],
    ["too_large", "too_large", "This file is too large to save."],
    [
      "fetch_failed: could not connect",
      "fetch_failed",
      "Couldn't reach the site. Check your connection and try again.",
    ],
  ])("maps the Rust error %s", async (raw, code, message) => {
    invokeMock.mockRejectedValue(raw);

    const error = await desktopSourceFetch({ url: "https://example.com/" }).catch((e) => e);
    expect(error).toBeInstanceOf(SourceError);
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
  });

  it("rejects with an AbortError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await desktopSourceFetch({
      url: "https://example.com/",
      signal: controller.signal,
    }).catch((e) => e);

    expect(error.name).toBe("AbortError");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects with an AbortError when aborted mid-flight, without waiting for Rust", async () => {
    invokeMock.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();

    const pending = desktopSourceFetch({
      url: "https://example.com/",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledOnce());
    controller.abort();

    const error = await pending.catch((e) => e);
    expect(error.name).toBe("AbortError");
  });
});
