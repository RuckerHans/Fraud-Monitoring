import type { Metadata } from 'next';
import { Inter, Manrope } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-body' });
const manrope = Manrope({ subsets: ['latin'], variable: '--font-display' });

export const metadata: Metadata = {
  title: 'Fraud Monitoring',
  description: 'Branch-level retail exception reporting',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${manrope.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
