import { describe, expect, it } from "vitest";
import { isLocalNetworkUrl } from "../src/local-address";

describe("isLocalNetworkUrl", () => {
  it.each([
    "http://localhost/",
    "http://LOCALHOST:8080/x",
    "http://app.localhost/",
    "http://printer.local/",
    "http://intranet/",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://192.168.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]/",
    "file:///etc/passwd",
    "not a url at all",
  ])("refuses %s", (url) => {
    expect(isLocalNetworkUrl(url)).toBe(true);
  });

  it.each(["https://example.com/", "https://en.wikipedia.org/wiki/Car", "http://8.8.8.8/"])(
    "allows %s",
    (url) => {
      expect(isLocalNetworkUrl(url)).toBe(false);
    },
  );
});
