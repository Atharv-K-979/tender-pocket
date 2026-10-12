import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "TenderPocket — Intelligent Tender Tracker",
  description: "Scrape, monitor, and filter tenders received via Tender247 daily email alerts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark">
      <body>
        {children}
        <Script src="/api/compliance-progress-client?v=20261012-sanitize-2" strategy="beforeInteractive" />
      </body>
    </html>
  );
}
