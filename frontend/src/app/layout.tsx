import type { Metadata } from "next";
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
