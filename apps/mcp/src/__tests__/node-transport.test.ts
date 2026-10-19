import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeFetch, nodeFetch } from "../links/node-transport";

describe("node-transport", () => {
  const serversToClose: http.Server[] = [];

  afterEach(async () => {
    while (serversToClose.length > 0) {
      const server = serversToClose.pop()!;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  function startServer(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  ): Promise<number> {
    return new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, "127.0.0.1", () => {
        serversToClose.push(server);
        const port = (server.address() as AddressInfo).port;
        resolve(port);
      });
    });
  }

  it("returns status and headers and reads body", async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(200, {
        "x-custom-header": "test-value",
        "content-type": "text/plain",
      });
      res.end("hello from transport");
    });

    const res = await nodeFetch(`http://127.0.0.1:${port}/hello`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-custom-header")).toBe("test-value");
    expect(await res.text()).toBe("hello from transport");
    expect(res.url).toBe(`http://127.0.0.1:${port}/hello`);
  });

  it("returns a gzip and a br body decompressed", async () => {
    const rawText = "compressed text payload for decompression testing";
    const gzipBuf = zlib.gzipSync(Buffer.from(rawText));
    const brBuf = zlib.brotliCompressSync(Buffer.from(rawText));

    const port = await startServer((req, res) => {
      if (req.url === "/gzip") {
        res.writeHead(200, {
          "content-encoding": "gzip",
          "content-length": String(gzipBuf.length),
        });
        res.end(gzipBuf);
      } else if (req.url === "/br") {
        res.writeHead(200, {
          "content-encoding": "br",
          "content-length": String(brBuf.length),
        });
        res.end(brBuf);
      }
    });

    const gzRes = await nodeFetch(`http://127.0.0.1:${port}/gzip`);
    expect(gzRes.status).toBe(200);
    expect(gzRes.headers.get("content-encoding")).toBeNull();
    expect(gzRes.headers.get("content-length")).toBeNull();
    expect(await gzRes.text()).toBe(rawText);

    const brRes = await nodeFetch(`http://127.0.0.1:${port}/br`);
    expect(brRes.status).toBe(200);
    expect(brRes.headers.get("content-encoding")).toBeNull();
    expect(brRes.headers.get("content-length")).toBeNull();
    expect(await brRes.text()).toBe(rawText);
  });

  it("handles a 40 KB set-cookie header without overflow", async () => {
    const largeCookieValue = "x".repeat(40 * 1024);
    const port = await startServer((_req, res) => {
      res.writeHead(200, {
        "set-cookie": `large_session=${largeCookieValue}; Path=/`,
      });
      res.end("ok");
    });

    const res = await nodeFetch(`http://127.0.0.1:${port}/cookie`);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie!.length).toBeGreaterThanOrEqual(40 * 1024);
    expect(await res.text()).toBe("ok");
  });

  it("returns a 302 without following it", async () => {
    const port = await startServer((_req, res) => {
      res.writeHead(302, { location: "/redirected" });
      res.end("redirecting");
    });

    const res = await nodeFetch(`http://127.0.0.1:${port}/start`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/redirected");
  });

  it("rejects with AbortError when signal is aborted", async () => {
    const port = await startServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end("delayed");
      }, 500);
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    await expect(
      nodeFetch(`http://127.0.0.1:${port}/hang`, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("trips timeout when server never answers", async () => {
    const port = await startServer((_req, _res) => {
      // Intentionally do not answer
    });

    const quickFetch = createNodeFetch({ connectTimeoutMs: 50, idleTimeoutMs: 50 });
    await expect(quickFetch(`http://127.0.0.1:${port}/slow`)).rejects.toMatchObject({
      code: "ETIMEDOUT",
    });
  });

  it("rejects with code ECONNREFUSED on a closed port", async () => {
    const port = await startServer((_req, res) => res.end());
    // Close the server immediately so port is closed
    const server = serversToClose.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await expect(nodeFetch(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });
  });

  it("errors body stream when socket is destroyed mid-body and leaves no uncaught exceptions", async () => {
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => {
      uncaught.push(err);
    };
    process.on("uncaughtException", onUncaught);

    try {
      const port = await startServer((req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.write("first part of chunk");
        setTimeout(() => {
          req.socket.destroy();
        }, 30);
      });

      const res = await nodeFetch(`http://127.0.0.1:${port}/destroy-mid-body`);
      expect(res.status).toBe(200);
      await expect(res.text()).rejects.toThrow();

      // Wait a tick for any delayed socket error events
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(uncaught).toHaveLength(0);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});
