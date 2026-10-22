/** Links and copy shared by every section. */

const RELEASES = "https://github.com/lagoonitself/sourcefold/releases";
const REPO = "https://github.com/lagoonitself/sourcefold";

export const links = {
  repo: REPO,
  releases: RELEASES,
  windows: `${RELEASES}/latest/download/Sourcefold-Windows-Setup.exe`,
  mac: `${RELEASES}/latest/download/Sourcefold-Mac.dmg`,
  extension: `${RELEASES}/latest/download/Sourcefold-Chrome-Extension.zip`,
  claude: `${RELEASES}/latest/download/Sourcefold-Claude.mcpb`,
  install: `${REPO}/blob/main/docs/INSTALL.md`,
  selfHosting: `${REPO}/blob/main/docs/SELF-HOSTING.md`,
  fileFormat: `${REPO}/blob/main/docs/FILE-FORMAT.md`,
  privacy: `${REPO}/blob/main/PRIVACY.md`,
  changelog: `${REPO}/blob/main/CHANGELOG.md`,
  issues: `${REPO}/issues`,
  license: `${REPO}/blob/main/LICENSE`,
} as const;

/** The page's sections in order. `id` is the anchor; `nav` ones appear in the top bar. */
export const sections = [
  { id: "sources", label: "Sources", nav: true },
  { id: "save", label: "Save", nav: false },
  { id: "read", label: "Read", nav: true },
  { id: "search", label: "Search", nav: false },
  { id: "organize", label: "Organize", nav: false },
  { id: "research", label: "Research tools", nav: true },
  { id: "claude", label: "Claude", nav: true },
  { id: "files", label: "Your files", nav: false },
  { id: "apps", label: "Apps", nav: true },
  { id: "open-source", label: "Open source", nav: false },
  { id: "download", label: "Download", nav: false },
] as const;
