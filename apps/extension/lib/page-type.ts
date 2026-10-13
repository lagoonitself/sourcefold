export type PageType = 'grokipedia' | 'substack' | 'x' | null;

/**
 * Detects the page type from a URL.
 * Temporary local version.
 */
export function detectPageType(url: string | undefined): PageType {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    // Grokipedia: grokipedia.com/page/...
    if ((host === 'grokipedia.com' || host === 'www.grokipedia.com') && pathname.startsWith('/page/')) {
      return 'grokipedia';
    }

    // X: x.com or twitter.com URL containing /status/
    if (
      (host === 'x.com' ||
        host.endsWith('.x.com') ||
        host === 'twitter.com' ||
        host.endsWith('.twitter.com')) &&
      pathname.includes('/status/')
    ) {
      return 'x';
    }

    // Substack: host ending .substack.com with path starting /p/
    // TODO(wave 3): Custom-domain Substacks get detected from the page in a later wave
    if ((host === 'substack.com' || host.endsWith('.substack.com')) && pathname.startsWith('/p/')) {
      return 'substack';
    }

    return null;
  } catch {
    return null;
  }
}
