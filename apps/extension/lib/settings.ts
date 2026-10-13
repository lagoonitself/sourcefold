import { browser } from 'wxt/browser';

export interface ExtensionSettings {
  appUrl: string;
  token: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  appUrl: 'http://localhost:3000',
  token: '',
};

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await browser.storage.local.get(['appUrl', 'token']);
  const rawUrl = typeof result.appUrl === 'string' ? result.appUrl.trim() : '';
  const appUrl = rawUrl.length > 0 ? rawUrl.replace(/\/+$/, '') : DEFAULT_SETTINGS.appUrl;
  const token = typeof result.token === 'string' ? result.token.trim() : DEFAULT_SETTINGS.token;

  return { appUrl, token };
}

export async function saveSettings(partial: Partial<ExtensionSettings>): Promise<void> {
  const toSave: Record<string, string> = {};

  if (partial.appUrl !== undefined) {
    toSave.appUrl = partial.appUrl.trim().replace(/\/+$/, '');
  }

  if (partial.token !== undefined) {
    toSave.token = partial.token.trim();
  }

  await browser.storage.local.set(toSave);
}
