import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookup(...args) }));

const { BlockedAddressError, isPrivateAddress, publicFetch } = await import("./public-fetch");

describe("isPrivateAddress", () => {
  it("flags loopback, private, link-local, metadata and mapped addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "not an ip",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("lets public addresses through", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

describe("publicFetch", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    lookup.mockReset();
  });

  it("refuses private hosts, odd ports and local names before any request", async () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://[::1]/",
      "http://169.254.169.254/latest/meta-data",
      "https://example.com:8080/",
      "http://localhost/",
      "http://printer.local/",
      "file:///etc/passwd",
    ]) {
      await expect(publicFetch(url), url).rejects.toBeInstanceOf(BlockedAddressError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a name that resolves to a private address", async () => {
    lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(publicFetch("https://sneaky.example.com/")).rejects.toBeInstanceOf(
      BlockedAddressError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks every redirect hop", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }),
    );
    await expect(publicFetch("https://example.com/")).rejects.toBeInstanceOf(BlockedAddressError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows public redirects and returns the final response", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "/moved" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const res = await publicFetch("https://example.com/start");
    expect(await res.text()).toBe("ok");
    expect(String(fetchMock.mock.calls[1]![0])).toBe("https://example.com/moved");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
  });
});
