import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import { Readable, type Transform } from "node:stream";
import tls from "node:tls";
import zlib from "node:zlib";

export interface NodeFetchOptions {
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
}

const H2_FORBIDDEN = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function isHttp2Error(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (typeof code === "string" && code.startsWith("ERR_HTTP2_")) return true;
  const msg = (err as Error).message;
  return typeof msg === "string" && msg.includes("ERR_HTTP2_");
}

function extractHeaderPairs(input?: HeadersInit): [string, string][] {
  if (!input) return [];
  if (input instanceof Headers) {
    const pairs: [string, string][] = [];
    input.forEach((val, key) => pairs.push([key, val]));
    return pairs;
  }
  if (Array.isArray(input)) {
    return input.map(([k, v]) => [k, String(v)]);
  }
  const pairs: [string, string][] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) pairs.push([k, String(item)]);
    } else {
      pairs.push([k, String(v)]);
    }
  }
  return pairs;
}

function extractBodyBuffer(body: unknown): Buffer | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body, "utf-8");
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), "utf-8");
  return Buffer.from(String(body), "utf-8");
}

function handleDecompression(
  rawStream: Readable,
  headers: Headers,
): { stream: Readable; decompressorStream: Transform | null } {
  const encoding = (headers.get("content-encoding") ?? "").toLowerCase().trim();
  let decompressorStream: Transform | null = null;

  if (encoding === "gzip" || encoding === "x-gzip") {
    decompressorStream = zlib.createGunzip();
  } else if (encoding === "deflate") {
    decompressorStream = zlib.createInflate();
  } else if (encoding === "br") {
    decompressorStream = zlib.createBrotliDecompress();
  }

  if (decompressorStream) {
    decompressorStream.on("error", () => {});
    rawStream.on("error", (err) => {
      if (decompressorStream && !decompressorStream.destroyed) {
        decompressorStream.destroy(err);
      }
    });
    decompressorStream.on("close", () => {
      if (!rawStream.destroyed) {
        rawStream.destroy();
      }
    });
    rawStream.pipe(decompressorStream);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return { stream: decompressorStream, decompressorStream };
  }

  return { stream: rawStream, decompressorStream: null };
}

function doHttpsRequest(
  url: URL,
  method: string,
  h1Headers: Record<string, string | string[]>,
  h2Headers: Record<string, string | string[]>,
  bodyBuffer: Buffer | undefined,
  signal: AbortSignal | null | undefined,
  opts: NodeFetchOptions,
  alpnProtocols: string[],
  isRetry: boolean,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let responseArrived = false;
    let socket: tls.TLSSocket | null = null;
    let session: http2.ClientHttp2Session | null = null;
    let decompressor: Transform | null = null;
    let rawStream: Readable | null = null;
    let connectTimer: NodeJS.Timeout | null = null;

    const safeReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      reject(err);
    };

    const onAbort = () => {
      const reason = signal?.reason ?? new DOMException("This operation was aborted", "AbortError");
      if (!responseArrived) {
        safeReject(reason);
        if (socket && !socket.destroyed) socket.destroy(reason);
        if (session && !session.destroyed) session.destroy(reason);
      } else {
        if (socket && !socket.destroyed) socket.destroy(reason);
        if (session && !session.destroyed) session.destroy(reason);
        if (decompressor && !decompressor.destroyed) decompressor.destroy(reason);
        if (rawStream && !rawStream.destroyed) rawStream.destroy(reason);
      }
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const cleanupListeners = () => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const connectTimeoutMs = opts.connectTimeoutMs ?? 20_000;
    const idleTimeoutMs = opts.idleTimeoutMs ?? 30_000;

    const cleanHost = url.hostname.replace(/^\[|\]$/g, "");
    const port = url.port ? parseInt(url.port, 10) : 443;
    const servername = net.isIP(cleanHost) ? undefined : cleanHost;

    try {
      socket = tls.connect({
        host: cleanHost,
        port,
        servername,
        ALPNProtocols: alpnProtocols,
      });
    } catch (err) {
      safeReject(err);
      return;
    }

    socket.on("error", (err) => {
      if (!responseArrived) {
        safeReject(err);
      }
    });

    connectTimer = setTimeout(() => {
      const err = new Error("Connect timed out");
      Object.assign(err, { code: "ETIMEDOUT" });
      if (socket && !socket.destroyed) socket.destroy(err);
      safeReject(err);
    }, connectTimeoutMs);

    socket.on("secureConnect", () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      if (settled || !socket) return;

      socket.setTimeout(idleTimeoutMs);
      socket.on("timeout", () => {
        const err = new Error("Socket idle timeout");
        Object.assign(err, { code: "ETIMEDOUT" });
        if (socket && !socket.destroyed) socket.destroy(err);
        if (!responseArrived) {
          safeReject(err);
        }
      });

      if (socket.alpnProtocol === "h2") {
        try {
          session = http2.connect(url.origin, {
            createConnection: () => socket!,
            maxSessionMemory: 64,
            settings: { maxHeaderListSize: 262144 },
          });
        } catch (err) {
          safeReject(err);
          return;
        }

        session.on("error", (err) => {
          if (!responseArrived) {
            if (!isRetry && isHttp2Error(err)) {
              cleanupListeners();
              if (session && !session.destroyed) session.destroy();
              if (socket && !socket.destroyed) socket.destroy();
              doHttpsRequest(
                url,
                method,
                h1Headers,
                h2Headers,
                bodyBuffer,
                signal,
                opts,
                ["http/1.1"],
                true,
              ).then(resolve, reject);
              return;
            }
            safeReject(err);
          }
        });

        const h2Req = session.request(h2Headers);
        rawStream = h2Req;

        h2Req.on("error", (err) => {
          if (!responseArrived) {
            if (!isRetry && isHttp2Error(err)) {
              cleanupListeners();
              if (session && !session.destroyed) session.destroy();
              if (socket && !socket.destroyed) socket.destroy();
              doHttpsRequest(
                url,
                method,
                h1Headers,
                h2Headers,
                bodyBuffer,
                signal,
                opts,
                ["http/1.1"],
                true,
              ).then(resolve, reject);
              return;
            }
            safeReject(err);
          }
        });

        h2Req.on("response", (resHeaders) => {
          responseArrived = true;
          const status = Number(resHeaders[":status"] ?? 200);
          const headers = new Headers();
          for (const [key, val] of Object.entries(resHeaders)) {
            if (key.startsWith(":")) continue;
            if (Array.isArray(val)) {
              for (const v of val) headers.append(key, v);
            } else if (val !== undefined) {
              headers.append(key, String(val));
            }
          }

          const isHead = method.toUpperCase() === "HEAD";
          const isNoBody = isHead || status === 204 || status === 205 || status === 304;

          if (isNoBody) {
            cleanupListeners();
            if (session && !session.closed && !session.destroyed) session.close();
            const response = new Response(null, { status, headers });
            Object.defineProperty(response, "url", { value: url.href });
            settled = true;
            resolve(response);
            return;
          }

          const { stream: decodedStream, decompressorStream } = handleDecompression(h2Req, headers);
          decompressor = decompressorStream;

          const cleanupSession = () => {
            if (socket) socket.setTimeout(0);
            if (session && !session.closed && !session.destroyed) {
              session.close();
            }
            cleanupListeners();
          };

          decodedStream.on("end", cleanupSession);
          decodedStream.on("close", cleanupSession);
          decodedStream.on("error", cleanupSession);

          const webStream = Readable.toWeb(decodedStream);
          const response = new Response(webStream as ReadableStream<Uint8Array>, {
            status,
            headers,
          });
          Object.defineProperty(response, "url", { value: url.href });
          settled = true;
          resolve(response);
        });

        if (bodyBuffer) {
          h2Req.end(bodyBuffer);
        } else {
          h2Req.end();
        }
      } else {
        const h1Req = https.request(url, {
          method,
          headers: h1Headers,
          createConnection: () => socket!,
          agent: false,
          maxHeaderSize: 262144,
        });

        h1Req.on("error", (err) => {
          if (!responseArrived) {
            safeReject(err);
          }
        });

        h1Req.on("response", (incomingRes) => {
          responseArrived = true;
          rawStream = incomingRes;
          incomingRes.on("error", () => {});

          const status = incomingRes.statusCode ?? 200;
          const headers = new Headers();
          const raw = incomingRes.rawHeaders;
          for (let i = 0; i < raw.length; i += 2) {
            headers.append(raw[i]!, raw[i + 1]!);
          }

          const isHead = method.toUpperCase() === "HEAD";
          const isNoBody = isHead || status === 204 || status === 205 || status === 304;

          if (isNoBody) {
            cleanupListeners();
            incomingRes.resume();
            const response = new Response(null, { status, headers });
            Object.defineProperty(response, "url", { value: url.href });
            settled = true;
            resolve(response);
            return;
          }

          const { stream: decodedStream, decompressorStream } = handleDecompression(
            incomingRes,
            headers,
          );
          decompressor = decompressorStream;

          const cleanupH1 = () => {
            if (socket) socket.setTimeout(0);
            cleanupListeners();
          };

          decodedStream.on("end", cleanupH1);
          decodedStream.on("close", cleanupH1);
          decodedStream.on("error", cleanupH1);

          const webStream = Readable.toWeb(decodedStream);
          const response = new Response(webStream as ReadableStream<Uint8Array>, {
            status,
            headers,
          });
          Object.defineProperty(response, "url", { value: url.href });
          settled = true;
          resolve(response);
        });

        if (bodyBuffer) {
          h1Req.end(bodyBuffer);
        } else {
          h1Req.end();
        }
      }
    });
  });
}

function doHttpRequest(
  url: URL,
  method: string,
  h1Headers: Record<string, string | string[]>,
  bodyBuffer: Buffer | undefined,
  signal: AbortSignal | null | undefined,
  opts: NodeFetchOptions,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    let responseArrived = false;
    let socket: net.Socket | null = null;
    let req: http.ClientRequest | null = null;
    let decompressor: Transform | null = null;
    let rawStream: Readable | null = null;
    let connectTimer: NodeJS.Timeout | null = null;

    const safeReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      reject(err);
    };

    const onAbort = () => {
      const reason = signal?.reason ?? new DOMException("This operation was aborted", "AbortError");
      if (!responseArrived) {
        safeReject(reason);
        if (socket && !socket.destroyed) socket.destroy(reason);
        if (req && !req.destroyed) req.destroy(reason);
      } else {
        if (socket && !socket.destroyed) socket.destroy(reason);
        if (req && !req.destroyed) req.destroy(reason);
        if (decompressor && !decompressor.destroyed) decompressor.destroy(reason);
        if (rawStream && !rawStream.destroyed) rawStream.destroy(reason);
      }
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const cleanupListeners = () => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const connectTimeoutMs = opts.connectTimeoutMs ?? 20_000;
    const idleTimeoutMs = opts.idleTimeoutMs ?? 30_000;

    try {
      req = http.request(url, {
        method,
        headers: h1Headers,
        agent: false,
        maxHeaderSize: 262144,
      });
    } catch (err) {
      safeReject(err);
      return;
    }

    req.on("error", (err) => {
      if (!responseArrived) {
        safeReject(err);
      }
    });

    req.on("socket", (sock) => {
      socket = sock;
      sock.on("error", (err) => {
        if (!responseArrived) {
          safeReject(err);
        }
      });

      const onConnected = () => {
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }
        sock.setTimeout(idleTimeoutMs);
        sock.on("timeout", () => {
          const err = new Error("Socket idle timeout");
          Object.assign(err, { code: "ETIMEDOUT" });
          if (!sock.destroyed) sock.destroy(err);
          if (!responseArrived) {
            safeReject(err);
          }
        });
      };

      if (sock.connecting) {
        connectTimer = setTimeout(() => {
          const err = new Error("Connect timed out");
          Object.assign(err, { code: "ETIMEDOUT" });
          if (!sock.destroyed) sock.destroy(err);
          safeReject(err);
        }, connectTimeoutMs);

        sock.once("connect", onConnected);
      } else {
        onConnected();
      }
    });

    req.on("response", (incomingRes) => {
      responseArrived = true;
      rawStream = incomingRes;
      incomingRes.on("error", () => {});

      const status = incomingRes.statusCode ?? 200;
      const headers = new Headers();
      const raw = incomingRes.rawHeaders;
      for (let i = 0; i < raw.length; i += 2) {
        headers.append(raw[i]!, raw[i + 1]!);
      }

      const isHead = method.toUpperCase() === "HEAD";
      const isNoBody = isHead || status === 204 || status === 205 || status === 304;

      if (isNoBody) {
        cleanupListeners();
        incomingRes.resume();
        const response = new Response(null, { status, headers });
        Object.defineProperty(response, "url", { value: url.href });
        settled = true;
        resolve(response);
        return;
      }

      const { stream: decodedStream, decompressorStream } = handleDecompression(
        incomingRes,
        headers,
      );
      decompressor = decompressorStream;

      const cleanupH1 = () => {
        if (socket) socket.setTimeout(0);
        cleanupListeners();
      };

      decodedStream.on("end", cleanupH1);
      decodedStream.on("close", cleanupH1);
      decodedStream.on("error", cleanupH1);

      const webStream = Readable.toWeb(decodedStream);
      const response = new Response(webStream as ReadableStream<Uint8Array>, { status, headers });
      Object.defineProperty(response, "url", { value: url.href });
      settled = true;
      resolve(response);
    });

    if (bodyBuffer) {
      req.end(bodyBuffer);
    } else {
      req.end();
    }
  });
}

export function createNodeFetch(opts: NodeFetchOptions = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    let method: string;
    let headersInput: HeadersInit | undefined;
    let bodyInput: BodyInit | null | undefined;
    let signal: AbortSignal | null | undefined;
    let url: URL;

    if (input instanceof Request) {
      url = new URL(input.url);
      method = init?.method ?? input.method ?? "GET";
      headersInput = init?.headers ?? input.headers;
      bodyInput =
        init?.body !== undefined ? init.body : (input as unknown as { body?: BodyInit }).body;
      signal = init?.signal ?? input.signal;
    } else {
      url = new URL(typeof input === "string" ? input : input.href);
      method = init?.method ?? "GET";
      headersInput = init?.headers;
      bodyInput = init?.body;
      signal = init?.signal;
    }

    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("This operation was aborted", "AbortError");
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new TypeError(`Unsupported protocol: ${url.protocol}`);
    }

    const pairs = extractHeaderPairs(headersInput);
    const bodyBuffer = extractBodyBuffer(bodyInput);

    const h1Headers: Record<string, string | string[]> = {};
    for (const [k, v] of pairs) {
      const lower = k.toLowerCase();
      if (h1Headers[lower] === undefined) {
        h1Headers[lower] = v;
      } else if (Array.isArray(h1Headers[lower])) {
        (h1Headers[lower] as string[]).push(v);
      } else {
        h1Headers[lower] = [h1Headers[lower] as string, v];
      }
    }
    if (bodyBuffer && !h1Headers["content-length"]) {
      h1Headers["content-length"] = String(bodyBuffer.byteLength);
    }

    const h2Headers: Record<string, string | string[]> = {
      ":method": method.toUpperCase(),
      ":path": (url.pathname || "/") + url.search,
    };
    for (const [k, v] of pairs) {
      const lower = k.toLowerCase();
      if (H2_FORBIDDEN.has(lower) || lower.startsWith(":")) continue;
      if (h2Headers[lower] === undefined) {
        h2Headers[lower] = v;
      } else if (Array.isArray(h2Headers[lower])) {
        (h2Headers[lower] as string[]).push(v);
      } else {
        h2Headers[lower] = [h2Headers[lower] as string, v];
      }
    }
    if (bodyBuffer && !h2Headers["content-length"]) {
      h2Headers["content-length"] = String(bodyBuffer.byteLength);
    }

    if (url.protocol === "https:") {
      return doHttpsRequest(
        url,
        method,
        h1Headers,
        h2Headers,
        bodyBuffer,
        signal,
        opts,
        ["h2", "http/1.1"],
        false,
      );
    }

    return doHttpRequest(url, method, h1Headers, bodyBuffer, signal, opts);
  }) as typeof fetch;
}

export const nodeFetch: typeof fetch = createNodeFetch();
