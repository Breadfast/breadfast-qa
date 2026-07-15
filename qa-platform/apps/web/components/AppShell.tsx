import Link from 'next/link';

const NAV = [
  { href: '/onboarding', label: 'Setup', icon: '◆' },
  { href: '/', label: 'Dashboard', icon: '◧' },
  { href: '/stories', label: 'Stories', icon: '▤' },
  { href: '/stories/new', label: 'New Story', icon: '＋' },
  { href: '/analytics', label: 'Analytics', icon: '◔' },
  { href: '/coverage', label: 'Coverage', icon: '▩' },
  { href: '/test-data', label: 'Test Data', icon: '▦' },
  { href: '/frameworks', label: 'Frameworks', icon: '❏' },
  { href: '/diagnostics', label: 'Diagnostics', icon: '✚' },
  { href: '/knowledge', label: 'Knowledge', icon: '◈' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen flex overflow-hidden">
      <aside className="w-60 shrink-0 bg-ink text-[#AEC2D2] flex flex-col overflow-y-auto">
        <div className="px-5 py-5 border-b border-[#1c3a4f]">
          <div className="text-white font-semibold tracking-tight">Breadfast QA</div>
          <div className="font-mono text-[10px] tracking-[0.18em] text-accent-bright uppercase mt-1">
            Platform
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 p-3 text-sm">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-[#143047] hover:text-white transition-colors"
            >
              <span className="w-4 text-center text-accent-bright">{n.icon}</span>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto p-4 border-t border-[#1c3a4f] text-xs font-mono text-muted">
          v0.1
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
    </div>
  );
}
