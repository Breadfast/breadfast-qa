'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../lib/api';
import {
  PLATFORMS,
  PLATFORM_LABELS,
  platformNeeds,
  ENVIRONMENTS,
  EXECUTION_TYPES,
  OTP_METHODS,
  LOCALES,
  DEFAULT_DEVICES,
  LIFECYCLE_PHASES,
  DEFAULT_PHASE_KEYS,
  EXECUTION_MODELS,
  resolvePhaseSelection,
  type Platform,
} from '@qa/shared';

type Extra = { key: string; value: string };
interface Profile {
  id: string;
  name: string;
  jiraProject?: string;
  defaultPlatform?: string;
  defaultEnvironment?: string;
  defaultLocales?: string[];
  defaultExecutionType?: string;
  browserstack?: { project?: string; defaultFolder?: string };
  urls?: Record<string, string>;
  adminUrls?: Record<string, string>;
  defaultExecutionInstructions?: string;
}
interface Draft {
  jiraKey: string;
  platform: Platform;
  environment: string;
  locales: string[];
  notes: string;
  appUrl: string;
  adminUrl: string;
  bsAppIds: { android: string; ios: string };
  devices: { android: string; ios: string };
  credentials: { username: string; password: string; otpMethod: string; extra: Extra[] };
  bsFolderId: string;
  executionType: string;
  testDataFile: string;
  packageNumbers: string;
  executionInstructions: string;
  additionalInputs: string;
  phases: string[];
  executionModel: string;
}

const STEPS = ['Story', 'Steps & Model', 'Application', 'Credentials', 'BrowserStack', 'Test Data', 'Review'] as const;

const initial: Draft = {
  jiraKey: '',
  platform: 'web',
  environment: 'testing',
  locales: ['en-US', 'ar-EG'],
  notes: '',
  appUrl: '',
  adminUrl: '',
  bsAppIds: { android: '', ios: '' },
  devices: { android: DEFAULT_DEVICES.android, ios: DEFAULT_DEVICES.ios },
  credentials: { username: '', password: '', otpMethod: 'slack', extra: [] },
  bsFolderId: '',
  executionType: 'full',
  testDataFile: '',
  packageNumbers: '',
  executionInstructions: '',
  additionalInputs: '',
  phases: [...DEFAULT_PHASE_KEYS],
  executionModel: '',
};

export default function NewStoryWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needs = useMemo(() => platformNeeds(d.platform), [d.platform]);

  const set = (patch: Partial<Draft>) => setD((s) => ({ ...s, ...patch }));

  // Project Profiles — selecting one pre-fills its non-secret defaults (editable after).
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState('');
  useEffect(() => {
    api<{ profiles: Profile[] }>('/profiles').then((r) => setProfiles(r.profiles ?? [])).catch(() => {});
  }, []);
  function applyProfile(id: string) {
    setProfileId(id);
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    const env = p.defaultEnvironment || d.environment;
    setD((s) => ({
      ...s,
      platform: (PLATFORMS as readonly string[]).includes(p.defaultPlatform ?? '') ? (p.defaultPlatform as Platform) : s.platform,
      environment: env,
      locales: p.defaultLocales?.length ? p.defaultLocales : s.locales,
      executionType: p.defaultExecutionType || s.executionType,
      appUrl: p.urls?.[env] || p.urls?.testing || s.appUrl,
      adminUrl: p.adminUrls?.[env] || s.adminUrl,
      bsFolderId: p.browserstack?.defaultFolder || s.bsFolderId,
      executionInstructions: p.defaultExecutionInstructions || s.executionInstructions,
    }));
  }

  function buildPayload() {
    const p: any = {
      jiraKey: d.jiraKey,
      platform: d.platform,
      environment: d.environment,
      locales: d.locales,
      notes: d.notes || undefined,
      executionType: d.executionType,
      bsFolderId: d.bsFolderId || undefined,
      testDataFile: d.testDataFile || undefined,
      packageNumbers: d.packageNumbers || undefined,
      executionInstructions: d.executionInstructions || undefined,
      additionalInputs: d.additionalInputs || undefined,
      // Only send `phases` when the tester narrowed the set — full selection = omit
      // (server treats absent/empty as "run everything").
      phases: d.phases.length < DEFAULT_PHASE_KEYS.length ? resolvePhaseSelection(d.phases) : undefined,
      executionModel: d.executionModel || undefined,
      bsAppIds: {
        android: needs.android ? d.bsAppIds.android : undefined,
        ios: needs.ios ? d.bsAppIds.ios : undefined,
      },
      credentials: {
        username: d.credentials.username || undefined,
        password: d.credentials.password || undefined,
        otpMethod: d.credentials.otpMethod,
        extra: d.credentials.extra.filter((e) => e.key),
      },
    };
    if (needs.web) p.appUrl = d.appUrl || undefined;
    if (needs.mobile && d.adminUrl) p.adminUrl = d.adminUrl;
    if (needs.mobile) p.devices = { android: d.devices.android, ios: d.devices.ios };
    return p;
  }

  const stepValid = useMemo(() => {
    if (step === 0) return /^[A-Z][A-Z0-9]+-\d+$/.test(d.jiraKey) && d.locales.length > 0;
    if (step === 2) {
      if (needs.web && !d.appUrl) return false;
      if (needs.android && !d.bsAppIds.android) return false;
      if (needs.ios && !d.bsAppIds.ios) return false;
    }
    return true;
  }, [step, d, needs]);

  async function submit(run: boolean) {
    setBusy(true);
    setError(null);
    try {
      const story = await api<{ id: string }>('/stories', { method: 'POST', body: JSON.stringify(buildPayload()) });
      if (run) {
        await api(`/stories/${story.id}/runs`, { method: 'POST' });
        router.push(`/stories/${story.id}`);
      } else {
        router.push('/stories');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-8 py-7 max-w-2xl">
      <h1 className="text-2xl font-semibold text-ink tracking-tight">New Story</h1>
      <p className="text-sm text-muted mb-5">Provide everything once — the platform runs the full QA workflow.</p>

      <Stepper step={step} />

      <div className="rounded-xl border border-line bg-surface p-6 mt-5 flex flex-col gap-5">
        {step === 0 && <StoryStep d={d} set={set} profiles={profiles} profileId={profileId} onProfile={applyProfile} />}
        {step === 1 && <StepsModelStep d={d} set={set} />}
        {step === 2 && <ApplicationStep d={d} set={set} needs={needs} />}
        {step === 3 && <CredentialsStep d={d} set={set} />}
        {step === 4 && <BrowserStackStep d={d} set={set} />}
        {step === 5 && <TestDataStep d={d} set={set} />}
        {step === 6 && <ReviewStep d={d} needs={needs} />}

        {error && <p className="text-sm text-fail">{error}</p>}

        <div className="flex items-center justify-between pt-2 border-t border-line">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || busy}
            className="text-sm px-4 py-2 rounded-lg border border-line text-body hover:border-accent disabled:opacity-30"
          >
            ‹ Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={!stepValid}
              className="text-sm font-medium px-5 py-2 rounded-lg bg-accent text-white hover:bg-accent-bright disabled:opacity-40"
            >
              Next ›
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => submit(false)} disabled={busy} className="text-sm font-medium px-4 py-2 rounded-lg border border-line text-body hover:border-accent disabled:opacity-40">
                Create only
              </button>
              <button onClick={() => submit(true)} disabled={busy} className="text-sm font-medium px-5 py-2 rounded-lg bg-accent text-white hover:bg-accent-bright disabled:opacity-40">
                {busy ? 'Starting…' : 'Run QA ▸'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── steps ──────────────────────────────────────────────────────────────── */
function StoryStep({ d, set, profiles, profileId, onProfile }: StepProps & { profiles: Profile[]; profileId: string; onProfile: (id: string) => void }) {
  return (
    <>
      {profiles.length > 0 && (
        <Field label="Project (optional — pre-fills defaults)">
          <Select
            value={profileId}
            onChange={onProfile}
            options={['', ...profiles.map((p) => p.id)]}
            labels={{ '': 'None', ...Object.fromEntries(profiles.map((p) => [p.id, p.name])) }}
          />
          <Hint>Selecting a project fills Jira/BrowserStack/URLs/environment defaults — all still editable below.</Hint>
        </Field>
      )}
      <Field label="Jira story ID / URL">
        <Text value={d.jiraKey} onChange={(v) => set({ jiraKey: v.toUpperCase().replace(/.*\/browse\//, '') })} placeholder="B10-56336" mono />
        {d.jiraKey && !/^[A-Z][A-Z0-9]+-\d+$/.test(d.jiraKey) && <Hint tone="fail">Expected a key like B10-56336</Hint>}
      </Field>
      <Field label="Platform">
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <Choice key={p} active={d.platform === p} onClick={() => set({ platform: p })}>{PLATFORM_LABELS[p]}</Choice>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Environment">
          <Select value={d.environment} onChange={(v) => set({ environment: v })} options={ENVIRONMENTS as unknown as string[]} />
        </Field>
        <Field label="Locales">
          <div className="flex gap-2 mt-1">
            {LOCALES.map((l) => {
              const on = d.locales.includes(l);
              return (
                <Choice key={l} active={on} onClick={() => set({ locales: on ? d.locales.filter((x) => x !== l) : [...d.locales, l] })}>{l}</Choice>
              );
            })}
          </div>
        </Field>
      </div>
      <Field label="Story notes (optional)">
        <textarea value={d.notes} onChange={(e) => set({ notes: e.target.value })} rows={2}
          className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
      </Field>
      <Field label="Execution instructions (optional)">
        <textarea value={d.executionInstructions} onChange={(e) => set({ executionInstructions: e.target.value })} rows={3}
          placeholder={'Story-specific guidance for the AI, e.g.\n• Validate only Android\n• Skip automation generation\n• Focus on regression scenarios\n• Ignore known issue B10-12345'}
          className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        <Hint>Honored across the whole workflow while still following the canonical QA process.</Hint>
      </Field>
    </>
  );
}

function StepsModelStep({ d, set }: StepProps) {
  const selectable = LIFECYCLE_PHASES.filter((p) => !p.mandatory);
  const on = (key: string) => d.phases.includes(key);

  function toggle(key: string) {
    const next = on(key) ? d.phases.filter((k) => k !== key) : [...d.phases, key];
    // Cascade dependency rules (e.g. Test cases off → Execution/Automation/Defects off).
    set({ phases: resolvePhaseSelection(next) });
  }
  // A phase whose dependency is unchecked can't be turned on — show it disabled.
  const blockedBy = (key: string): string | null => {
    const phase = selectable.find((p) => p.key === key);
    const dep = phase?.requires?.find((r) => !on(r));
    return dep ? (LIFECYCLE_PHASES.find((p) => p.key === dep)?.label ?? dep) : null;
  };

  return (
    <>
      <Field label="Steps to run">
        <p className="text-xs text-muted -mt-1 mb-2">
          Setup &amp; story retrieval always run. Uncheck any phase you don&apos;t need — dependent phases turn off automatically.
        </p>
        <div className="flex flex-col gap-1.5">
          {selectable.map((p) => {
            const blocked = blockedBy(p.key);
            const checked = on(p.key);
            return (
              <label
                key={p.key}
                className={`flex items-start gap-3 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                  checked ? 'border-accent bg-accent/5' : 'border-line hover:border-accent'
                } ${blocked && !checked ? 'opacity-45 cursor-not-allowed' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!!blocked && !checked}
                  onChange={() => toggle(p.key)}
                  className="mt-0.5 h-4 w-4 accent-accent"
                />
                <span className="flex flex-col">
                  <span className="text-sm text-ink">{p.label}</span>
                  <span className="text-xs text-muted">
                    {p.description}
                    {blocked && !checked ? ` · requires ${blocked}` : ''}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </Field>
      <Field label="Execution model">
        <Select
          value={d.executionModel}
          onChange={(v) => set({ executionModel: v })}
          options={EXECUTION_MODELS.map((m) => m.value)}
          labels={Object.fromEntries(EXECUTION_MODELS.map((m) => [m.value, m.label]))}
        />
        <Hint>Model used for the Execution step only. Analysis &amp; generation steps keep their platform defaults.</Hint>
      </Field>
    </>
  );
}

function ApplicationStep({ d, set, needs }: StepProps & { needs: ReturnType<typeof platformNeeds> }) {
  return (
    <>
      {needs.web && (
        <Field label="Application URL (web)">
          <Text value={d.appUrl} onChange={(v) => set({ appUrl: v })} placeholder="https://card-panel-testing.breadfast.tech" />
        </Field>
      )}
      {needs.android && (
        <Field label="Android BrowserStack App ID">
          <Text value={d.bsAppIds.android} onChange={(v) => set({ bsAppIds: { ...d.bsAppIds, android: v } })} placeholder="bs://<android-app-id>" mono />
        </Field>
      )}
      {needs.ios && (
        <Field label="iOS BrowserStack App ID">
          <Text value={d.bsAppIds.ios} onChange={(v) => set({ bsAppIds: { ...d.bsAppIds, ios: v } })} placeholder="bs://<ios-app-id>" mono />
        </Field>
      )}
      {needs.mobile && (
        <>
          <Field label="Admin / Web portal URL (optional)">
            <Text value={d.adminUrl} onChange={(v) => set({ adminUrl: v })} placeholder="https://control-room-testing.breadfast.tech" />
            <Hint>Only if the mobile story also touches an admin/web portal.</Hint>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            {needs.android && (
              <Field label="Android device"><Text value={d.devices.android} onChange={(v) => set({ devices: { ...d.devices, android: v } })} /></Field>
            )}
            {needs.ios && (
              <Field label="iOS device"><Text value={d.devices.ios} onChange={(v) => set({ devices: { ...d.devices, ios: v } })} /></Field>
            )}
          </div>
        </>
      )}
      {!needs.web && !needs.mobile && <p className="text-sm text-muted">No application inputs for this platform.</p>}
    </>
  );
}

function CredentialsStep({ d, set }: StepProps) {
  const c = d.credentials;
  const setExtra = (extra: Extra[]) => set({ credentials: { ...c, extra } });
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Username"><Text value={c.username} onChange={(v) => set({ credentials: { ...c, username: v } })} /></Field>
        <Field label="Password"><Text value={c.password} onChange={(v) => set({ credentials: { ...c, password: v } })} type="password" /></Field>
      </div>
      <Field label="OTP method">
        <Select value={c.otpMethod} onChange={(v) => set({ credentials: { ...c, otpMethod: v } })} options={OTP_METHODS as unknown as string[]} />
        <Hint>slack = login OTP from #testing-otp · device-last4 = card OTP (last 4 of phone)</Hint>
      </Field>
      <Field label="Additional credentials (optional)">
        <div className="flex flex-col gap-2">
          {c.extra.map((e, i) => (
            <div key={i} className="flex gap-2">
              <Text value={e.key} onChange={(v) => setExtra(c.extra.map((x, j) => (j === i ? { ...x, key: v } : x)))} placeholder="key" />
              <Text value={e.value} onChange={(v) => setExtra(c.extra.map((x, j) => (j === i ? { ...x, value: v } : x)))} placeholder="value" />
              <button onClick={() => setExtra(c.extra.filter((_, j) => j !== i))} className="px-2 text-muted hover:text-fail">✕</button>
            </div>
          ))}
          <button onClick={() => setExtra([...c.extra, { key: '', value: '' }])} className="self-start text-sm text-accent">+ add credential</button>
        </div>
      </Field>
      <Field label="Additional inputs (optional)">
        <textarea value={d.additionalInputs} onChange={(e) => set({ additionalInputs: e.target.value })} rows={3}
          placeholder="Any extra data or credentials that don't fit a field above — surfaced to the AI as context."
          className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
      </Field>
    </>
  );
}

function BrowserStackStep({ d, set }: StepProps) {
  return (
    <>
      <Field label="Destination folder (optional override)">
        <Text value={d.bsFolderId} onChange={(v) => set({ bsFolderId: v })} placeholder="defaults to Settings → BrowserStack" mono />
      </Field>
      <Field label="Execution type">
        <div className="flex gap-2">
          {EXECUTION_TYPES.map((t) => (
            <Choice key={t} active={d.executionType === t} onClick={() => set({ executionType: t })}>{t}</Choice>
          ))}
        </div>
      </Field>
      <p className="text-xs text-muted">BrowserStack credentials, project &amp; default folder live in <Link href="/settings" className="text-accent">Settings</Link>.</p>
    </>
  );
}

function TestDataStep({ d, set }: StepProps) {
  const [stats, setStats] = useState<Record<string, { available: number; reserved: number; consumed: number }> | null>(null);
  useEffect(() => { api('/test-data/stats').then((s) => setStats(s as any)).catch(() => setStats(null)); }, []);
  return (
    <>
      <Field label="Available test data">
        {stats ? (
          <div className="grid grid-cols-5 gap-2">
            {Object.entries(stats).map(([type, c]) => (
              <div key={type} className="rounded-lg border border-line p-2 text-center">
                <div className="text-lg font-semibold text-pass tnum">{c.available}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted">{type}</div>
              </div>
            ))}
          </div>
        ) : <Hint>Could not load pool.</Hint>}
        <Hint>Available items are auto-allocated during execution. Manage the pool in <Link href="/test-data" className="text-accent">Test Data</Link>.</Hint>
      </Field>
      <Field label="Existing package numbers (optional)">
        <Text value={d.packageNumbers} onChange={(v) => set({ packageNumbers: v })} placeholder="comma-separated" mono />
      </Field>
      <Field label="Test data file (optional)">
        <Text value={d.testDataFile} onChange={(v) => set({ testDataFile: v })} placeholder="path to CSV/JSON" mono />
      </Field>
    </>
  );
}

function ReviewStep({ d, needs }: { d: Draft; needs: ReturnType<typeof platformNeeds> }) {
  const rows: Array<[string, string | undefined]> = [
    ['Jira story', d.jiraKey],
    ['Platform', PLATFORM_LABELS[d.platform]],
    ['Environment', d.environment],
    ['Locales', d.locales.join(', ')],
    ['Application URL', needs.web ? d.appUrl : '—'],
    ['Android App ID', needs.android ? d.bsAppIds.android : '—'],
    ['iOS App ID', needs.ios ? d.bsAppIds.ios : '—'],
    ['Admin/Web URL', needs.mobile ? d.adminUrl || '—' : '—'],
    ['Credentials', d.credentials.username ? `${d.credentials.username} · OTP: ${d.credentials.otpMethod}` : `OTP: ${d.credentials.otpMethod}`],
    ['BrowserStack folder', d.bsFolderId || 'Settings default'],
    ['Execution type', d.executionType],
    ['Steps to run', d.phases.length >= DEFAULT_PHASE_KEYS.length ? 'All phases'
      : LIFECYCLE_PHASES.filter((p) => !p.mandatory && d.phases.includes(p.key)).map((p) => p.label).join(', ') || 'Setup only'],
    ['Execution model', EXECUTION_MODELS.find((m) => m.value === d.executionModel)?.label ?? EXECUTION_MODELS[0].label],
    ['Package numbers', d.packageNumbers || '—'],
    ['Execution instructions', d.executionInstructions || '—'],
    ['Additional inputs', d.additionalInputs || '—'],
    ['Notes', d.notes || '—'],
  ];
  return (
    <>
      <div className="text-sm font-medium text-ink">Review &amp; run</div>
      <div className="rounded-lg border border-line divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-3 py-2 text-sm">
            <span className="text-muted">{k}</span>
            <span className="text-ink text-right break-all">{v || '—'}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Run QA executes the full workflow and only pauses for genuine clarifications or approvals before writing to Jira / BrowserStack.</p>
    </>
  );
}

/* ── primitives ─────────────────────────────────────────────────────────── */
type StepProps = { d: Draft; set: (p: Partial<Draft>) => void };

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1 text-[11px] font-mono">
      {STEPS.map((s, i) => (
        <div key={s} className="flex items-center gap-1">
          <span className={`flex items-center gap-1.5 px-2 py-1 rounded-full ${i === step ? 'bg-accent text-white' : i < step ? 'text-accent' : 'text-muted'}`}>
            <span className={`w-4 h-4 rounded-full inline-flex items-center justify-center ${i === step ? 'bg-white text-accent' : i < step ? 'bg-accent text-white' : 'bg-line text-muted'}`}>{i < step ? '✓' : i + 1}</span>
            {s}
          </span>
          {i < STEPS.length - 1 && <span className="text-line">—</span>}
        </div>
      ))}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-mono uppercase tracking-wider text-muted">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
function Text({ value, onChange, placeholder, mono, type }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; type?: string }) {
  return (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type ?? 'text'}
      className={`w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent ${mono ? 'font-mono' : ''}`} />
  );
}
function Select({ value, onChange, options, labels }: { value: string; onChange: (v: string) => void; options: string[]; labels?: Record<string, string> }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-accent">
      {options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
    </select>
  );
}
function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${active ? 'bg-accent text-white border-accent' : 'border-line text-body hover:border-accent'}`}>{children}</button>
  );
}
function Hint({ children, tone }: { children: React.ReactNode; tone?: 'fail' }) {
  return <p className={`text-xs mt-1 ${tone === 'fail' ? 'text-fail' : 'text-muted'}`}>{children}</p>;
}
