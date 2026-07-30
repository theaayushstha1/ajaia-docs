import type { Metadata } from "next";
import "./globals.css";

/**
 * System fonts, deliberately. `next/font/google` downloads font files during
 * `next build`, which turns every Cloud Build run into a network dependency on
 * a third party. For a document tool where the type is the product, the native
 * UI font is also the one that already looks right on the reader's machine.
 */

export const metadata: Metadata = {
  title: "Ajaia Docs",
  description:
    "A lightweight collaborative document editor: write, import, and share.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-neutral-100 text-neutral-900">
        {children}
      </body>
    </html>
  );
}
