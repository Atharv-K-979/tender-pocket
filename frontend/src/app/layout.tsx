import type { Metadata } from "next";
import { Outfit, Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// The two fonts are downloaded once when the app is built and served from this website.
// (They used to come from fonts.googleapis.com, and no page was drawn until Google answered.)
const outfit = Outfit({ subsets: ["latin"], display: "swap", variable: "--font-outfit" });
const plusJakartaSans = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", variable: "--font-plus-jakarta-sans" });

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
    <html lang="en" data-theme="dark" className={`${outfit.variable} ${plusJakartaSans.variable}`}>
      <body>
        {children}
        <Script src="/api/compliance-progress-client?v=20261012-sanitize-2" strategy="beforeInteractive" />
      </body>
    </html>
  );
}
