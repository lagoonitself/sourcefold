import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@sourcefold/core"],
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
