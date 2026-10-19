import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isBotWall } from "./bot-wall";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8");

describe("isBotWall", () => {
  it("detects Imperva / Incapsula from apa.html fixture", () => {
    expect(isBotWall(fixture("apa.html"))).toBe(true);
  });

  it("detects DataDome from nyt.html fixture", () => {
    expect(isBotWall(fixture("nyt.html"))).toBe(true);
  });

  it("does not flag a regular article fixture", () => {
    expect(isBotWall(fixture("news-article.html"))).toBe(false);
  });

  it("detects Cloudflare challenge platform markers", () => {
    expect(
      isBotWall(
        '<html><body><script src="/cdn-cgi/challenge-platform/h/g"></script></body></html>',
      ),
    ).toBe(true);
    expect(isBotWall('<html><body><div id="cf_chl_prog"></div></body></html>')).toBe(true);
    expect(isBotWall('<html><body><div class="cf-browser-verification"></div></body></html>')).toBe(
      true,
    );
  });

  it("detects PerimeterX / HUMAN markers", () => {
    expect(isBotWall('<html><body><div id="px-captcha"></div></body></html>')).toBe(true);
    expect(isBotWall("<html><body><script>window._pxCaptcha = {};</script></body></html>")).toBe(
      true,
    );
  });

  it("detects AWS WAF markers when both awswaf and challenge appear", () => {
    expect(
      isBotWall(
        '<html><body><script src="awswaf-token"></script><div>challenge token</div></body></html>',
      ),
    ).toBe(true);
    expect(isBotWall("<html><body><div>Only awswaf here</div></body></html>")).toBe(false);
    expect(isBotWall("<html><body><div>Only challenge here</div></body></html>")).toBe(false);
  });

  it("detects Sucuri markers", () => {
    expect(isBotWall("<html><body><div>sucuri_cloudproxy error</div></body></html>")).toBe(true);
  });

  it("detects exact challenge page titles", () => {
    expect(
      isBotWall("<html><head><title>Just a moment...</title></head><body></body></html>"),
    ).toBe(true);
    expect(
      isBotWall(
        "<html><head><title>Attention Required! | Cloudflare</title></head><body></body></html>",
      ),
    ).toBe(true);
    expect(isBotWall("<html><head><title>Access Denied</title></head><body></body></html>")).toBe(
      true,
    );
    expect(
      isBotWall("<html><head><title>Pardon Our Interruption</title></head><body></body></html>"),
    ).toBe(true);
    expect(
      isBotWall("<html><head><title>Access Denied to Resource</title></head><body></body></html>"),
    ).toBe(false);
  });

  it("only checks the first 200,000 characters", () => {
    const padding = " ".repeat(200_001);
    const htmlWithLateMarker = padding + "captcha-delivery.com";
    expect(isBotWall(htmlWithLateMarker)).toBe(false);
  });
});
