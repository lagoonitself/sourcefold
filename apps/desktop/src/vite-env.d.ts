// Build-time settings (apps/desktop/.env.local, or repository variables in the release workflow).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** The website's address; invite links are `<it>/join/<code>`. Optional. */
  readonly VITE_SOURCEFOLD_WEB_URL?: string;
  /** The Content Worker's address (source text in R2). Optional: without it text stays in Drive. */
  readonly VITE_SOURCEFOLD_CONTENT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
