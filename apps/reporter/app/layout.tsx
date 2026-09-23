import type { Metadata } from 'next';
import { Fraunces, Public_Sans } from 'next/font/google';
import './globals.css';
import { TooltipLayer } from '@/components/tooltip-layer';
import { checkEnv } from '@/lib/env';

checkEnv();

/**
 * Fraunces for display, Public Sans for everything else.
 *
 * Fraunces is a warm, slightly editorial serif that sits with the sage palette
 * without tipping into fashion-magazine territory — its lower optical sizes
 * stay legible, which Bodoni-class faces do not. Public Sans carries dense
 * tabular data at 12-13px, which is most of this screen.
 *
 * Self-hosted by next/font, so there is no runtime request to Google and no
 * layout shift when the face arrives.
 */
// next/font rejects `axes` alongside explicit weights — the optional axes are
// only addressable when the weight itself is left variable. The SOFT/WONK axes
// are a nicety, the weight range is not, so the weights win.
const display = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-display',
  display: 'swap',
});

const sans = Public_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Azentio Reporter',
  description: 'Structure messy spreadsheets into approved, templated reports.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${display.variable} ${sans.variable}`}>
      <body>
        {children}
        <TooltipLayer />
      </body>
    </html>
  );
}
