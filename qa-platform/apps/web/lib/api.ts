// Same-origin: requests go to /api/* and Next rewrites them to the API
// (see next.config.js). No CORS, cookies are first-party.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';

/** Fetch JSON from the shared API, sending the session cookie. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  // Not signed in → send to the login page instead of surfacing a raw error.
  if ((res.status === 401 || res.status === 403) && typeof window !== 'undefined') {
    window.location.href = '/login';
    throw new Error('redirecting to login');
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export interface DashboardSummary {
  cards: { active: number; completed: number; running: number; defects: number; awaitingGates: number };
  recentRuns: Array<{
    id: string;
    status: string;
    totalCostUsd: number;
    story: { jiraKey: string; title: string };
  }>;
  coverage: number | null;
}
