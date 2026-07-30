import type { Metadata } from 'next';
import { Instrument_Sans, Newsreader } from 'next/font/google';
import './globals.css';

/**
 * Two faces, split by role rather than decoration.
 *
 * Newsreader sets the document canvas: it is a reading serif, so what the user
 * writes looks like something worth reading rather than like form input.
 * Instrument Sans sets the chrome, which should recede.
 *
 * next/font downloads these at build time and self-hosts the result, so there
 * is no third-party request from the browser and no layout shift.
 */
const sans = Instrument_Sans({
  variable: '--font-instrument-sans',
  subsets: ['latin'],
  display: 'swap',
});

const serif = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  display: 'swap',
  style: ['normal', 'italic'],
});

export const metadata: Metadata = {
  title: 'Ajaia Docs',
  description: 'A lightweight collaborative document editor: write, import, and share.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main-content"
          className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-canvas shadow-[var(--shadow-raised)] transition-transform focus:translate-y-0"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
