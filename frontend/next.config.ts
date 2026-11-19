import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "pdfkit-table"],
  images: {
    unoptimized: true
  },
  async rewrites() {
    return [
      {
        source: '/documents/:id/:filename*',
        destination: '/api/tenders/:id/documents/:filename*',
      },
    ];
  },
  async headers() {
    return [
      {
        // The tab icon (26 KB). Next.js sends it as "check every time" with nothing to check
        // against, so the browser downloaded it again on every page switch. Its link carries a
        // version (?favicon.<hash>.ico), so a changed icon still shows at once.
        source: '/favicon.ico',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
    ];
  },
};

export default nextConfig;
