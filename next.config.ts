import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    // Exclude bots folder from compilation
    config.externals = config.externals || [];
    if (isServer) {
      config.externals.push({
        './bots': 'commonjs ./bots',
      });
    }
    return config;
  },
  // Exclude bots from TypeScript checking
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
