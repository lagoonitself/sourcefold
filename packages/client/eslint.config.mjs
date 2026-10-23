import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// The same TypeScript rules the website's lint applied to this code before it moved here.
export default defineConfig([...tseslint.configs.recommended]);
