// Detects bot-wall challenge and block pages (Imperva, DataDome, Cloudflare,
// PerimeterX/HUMAN, AWS WAF, Sucuri) answering HTTP 200 before they reach the parser.

const BOT_WALL_MARKERS: readonly string[] = [
  // Imperva / Incapsula
  "/_Incapsula_Resource",
  // DataDome
  "geo.captcha-delivery.com",
  // Cloudflare challenge platform
  "/cdn-cgi/challenge-platform/",
  "cf_chl_prog",
  "cf-browser-verification",
  // PerimeterX / HUMAN
  "px-captcha",
  "_pxCaptcha",
  // Sucuri
  "sucuri_cloudproxy",
];

const BOT_WALL_TITLES = new Set<string>([
  "Just a moment...",
  "Attention Required! | Cloudflare",
  "Access Denied",
  "Pardon Our Interruption",
]);

/**
 * Checks if a 200 HTML response body is actually an anti-bot challenge or block page.
 * Scans only the first 200,000 characters for known markers and exact challenge titles.
 */
export function isBotWall(html: string): boolean {
  const snippet = html.slice(0, 200_000);

  for (const marker of BOT_WALL_MARKERS) {
    if (snippet.includes(marker)) return true;
  }

  if (snippet.includes("awswaf") && snippet.includes("challenge")) {
    return true;
  }

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(snippet);
  if (titleMatch?.[1]) {
    const title = titleMatch[1].trim();
    if (BOT_WALL_TITLES.has(title)) return true;
  }

  return false;
}
