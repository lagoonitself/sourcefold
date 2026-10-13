import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sourcefold/core"],
  serverExternalPackages: ["linkedom"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
