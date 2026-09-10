import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "pdfkit-table"],
  images: {
    unoptimized: true
  }
};

export default nextConfig;
