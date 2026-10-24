/** Opens Settings at a section; App opens the dialog and SettingsDialog switches to the section. */
export const OPEN_SETTINGS_EVENT = "sourcefold:open-settings";

export function openSettings(section: string) {
  window.dispatchEvent(
    new CustomEvent<{ section: string }>(OPEN_SETTINGS_EVENT, { detail: { section } }),
  );
}
