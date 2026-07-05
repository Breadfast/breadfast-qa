import { API_BASE } from '../../lib/api';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ground">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 text-center">
        <div className="font-mono text-[11px] tracking-[0.18em] uppercase text-accent mb-2">
          Breadfast QA Platform
        </div>
        <h1 className="text-xl font-semibold text-ink mb-1">Sign in</h1>
        <p className="text-sm text-muted mb-6">Use your @breadfast.com Google account.</p>
        <a
          href={`${API_BASE}/auth/google`}
          className="block bg-accent text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-accent-bright transition-colors"
        >
          Continue with Google
        </a>
        <a
          href={`${API_BASE}/auth/dev`}
          className="block mt-3 text-sm font-medium px-4 py-2 rounded-lg border border-line text-body hover:border-accent transition-colors"
        >
          Dev sign-in (local)
        </a>
        <p className="text-xs text-muted mt-4">
          Dev sign-in works without a Google OAuth client — for local testing only.
        </p>
      </div>
    </div>
  );
}
