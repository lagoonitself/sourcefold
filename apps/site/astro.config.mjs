import { defineConfig } from "astro/config";

// The public landing page. Static output, so it can go on Vercel, Netlify or GitHub Pages.
export default defineConfig({
  output: "static",
});
