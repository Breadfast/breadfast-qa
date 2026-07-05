import './globals.css';
import type { Metadata } from 'next';
import { AppShell } from '../components/AppShell';

export const metadata: Metadata = {
  title: 'Breadfast QA Platform',
  description: 'The single entry point for all QA activities.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
