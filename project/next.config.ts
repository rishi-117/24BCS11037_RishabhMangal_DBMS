import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // `pg` opens raw TCP sockets and must stay outside the bundler.
  serverExternalPackages: ["pg"],
  outputFileTracingRoot: path.resolve(__dirname),
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
