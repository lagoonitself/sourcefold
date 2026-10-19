import { SourceError } from "@sourcefold/core";
import { describe, expect, it, vi } from "vitest";
import { CHROME_HEADERS, createNodeSourceFetch, createPublicFetch } from "../links/public-fetch";

describe("public-fetch cookie jar", () => {
  it("passes cookies from 3xx hops to subsequent hops within the same call", async () => {
    const recordedCookies: (string | null)[] = [];
    const fakeLookup = vi.fn(async (_host: string) => [{ address: "93.184.216.34" }]);

    const fakeFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      recordedCookies.push(headers.get("cookie"));

      if (url === "https://example.com/step1") {
        return new Response("redirect", {
          status: 302,
          headers: {
            location: "https://example.com/step2",
            "set-cookie": "session_id=secret123; Path=/; Domain=example.com",
          },
        });
      }
      if (url === "https://example.com/step2") {
        return new Response("final", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const publicFetch = createPublicFetch({ fetch: fakeFetch as typeof fetch, lookup: fakeLookup });
    const res = await publicFetch("https://example.com/step1");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("final");
    expect(recordedCookies).toHaveLength(2);
    expect(recordedCookies[0]).toBeNull();
    expect(recordedCookies[1]).toBe("session_id=secret123");

    // Second call starts with a fresh cookie jar
    recordedCookies.length = 0;
    await publicFetch("https://example.com/step2");
    expect(recordedCookies).toHaveLength(1);
    expect(recordedCookies[0]).toBeNull();
  });
});

describe("createNodeSourceFetch error mapping", () => {
  const fakeLookup = vi.fn(async (_host: string) => [{ address: "93.184.216.34" }]);

  const testErrorMapping = async (thrownErr: unknown, expectedMessage: string) => {
    const fakeFetch = vi.fn(async () => {
      throw thrownErr;
    });
    const sf = createNodeSourceFetch({ fetch: fakeFetch as typeof fetch, lookup: fakeLookup });
    try {
      await sf({ url: "https://example.com/page" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SourceError);
      expect((err as SourceError).code).toBe("fetch_failed");
      expect((err as SourceError).message).toBe(expectedMessage);
    }
  };

  it("maps ENOTFOUND and EAI_AGAIN to DNS lookup failed message", async () => {
    const enotfound = new Error("getaddrinfo ENOTFOUND example.com");
    Object.assign(enotfound, { code: "ENOTFOUND" });
    await testErrorMapping(
      enotfound,
      "Couldn't find the site's address (DNS lookup failed). Check the link.",
    );

    const eaiAgain = new Error("getaddrinfo EAI_AGAIN example.com");
    Object.assign(eaiAgain, { code: "EAI_AGAIN" });
    await testErrorMapping(
      eaiAgain,
      "Couldn't find the site's address (DNS lookup failed). Check the link.",
    );

    const lookupTypeError = new TypeError("Couldn't look up example.com");
    await testErrorMapping(
      lookupTypeError,
      "Couldn't find the site's address (DNS lookup failed). Check the link.",
    );
  });

  it("maps ECONNREFUSED to connection refused message", async () => {
    const err = new Error("connect ECONNREFUSED 93.184.216.34:443");
    Object.assign(err, { code: "ECONNREFUSED" });
    await testErrorMapping(err, "The site refused the connection.");
  });

  it("maps ECONNRESET and EPIPE to connection closed message", async () => {
    const errReset = new Error("read ECONNRESET");
    Object.assign(errReset, { code: "ECONNRESET" });
    await testErrorMapping(errReset, "The site closed the connection before answering.");

    const errPipe = new Error("write EPIPE");
    Object.assign(errPipe, { code: "EPIPE" });
    await testErrorMapping(errPipe, "The site closed the connection before answering.");
  });

  it("maps ETIMEDOUT to didn't answer in time message", async () => {
    const err = new Error("connect ETIMEDOUT");
    Object.assign(err, { code: "ETIMEDOUT" });
    await testErrorMapping(err, "The site didn't answer in time.");
  });

  it("maps TLS and certificate errors to secure connection refused message", async () => {
    for (const code of [
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "CERT_HAS_EXPIRED",
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "ERR_SSL_PROTOCOL_ERROR",
      "EPROTO",
    ]) {
      const err = new Error(`tls error ${code}`);
      Object.assign(err, { code });
      await testErrorMapping(
        err,
        "Couldn't make a secure connection to the site (its certificate or encryption was refused).",
      );
    }
  });

  it("maps Too many redirects TypeError to redirected message", async () => {
    const err = new TypeError("Too many redirects");
    await testErrorMapping(err, "The site kept redirecting, so the page never loaded.");
  });

  it("maps unknown errors to generic couldn't reach message", async () => {
    const err = new Error("something completely unexpected");
    await testErrorMapping(err, "Couldn't reach the site. Check your connection and try again.");
  });

  it("rethrows AbortError and TimeoutError untouched", async () => {
    const abortErr = new DOMException("This operation was aborted", "AbortError");
    const fakeFetch = vi.fn(async () => {
      throw abortErr;
    });
    const sf = createNodeSourceFetch({ fetch: fakeFetch as typeof fetch, lookup: fakeLookup });
    await expect(sf({ url: "https://example.com/page" })).rejects.toThrow(abortErr);
  });

  it("sends full Chrome navigation headers by default and lets custom accept win", async () => {
    let capturedHeaders: HeadersInit | undefined;
    const fakeFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response("ok", { status: 200 });
    });
    const sf = createNodeSourceFetch({ fetch: fakeFetch as typeof fetch, lookup: fakeLookup });

    await sf({ url: "https://example.com/" });
    const headers = capturedHeaders as Record<string, string>;
    expect(headers["user-agent"]).toBe(CHROME_HEADERS["user-agent"]);
    expect(headers["sec-ch-ua"]).toBe(CHROME_HEADERS["sec-ch-ua"]);
    expect(headers["upgrade-insecure-requests"]).toBe("1");
    expect(headers["accept"]).toBe(CHROME_HEADERS["accept"]);

    // Custom accept wins
    await sf({ url: "https://example.com/", headers: { Accept: "application/json" } });
    const customHeaders = capturedHeaders as Record<string, string>;
    expect(customHeaders["accept"]).toBe("application/json");
  });
});
