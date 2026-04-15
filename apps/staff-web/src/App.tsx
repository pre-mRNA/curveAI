import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  connectCalendar,
  getJobCard,
  getStaffJobs,
  getStaffProfile,
  savePricingInterview,
  saveVoiceConsent,
  verifyStaffOtp,
} from './api/client';
import { ProtectedImage } from './ProtectedImage';
import { clearStaffSession, readStaffSession, saveStaffSession, updateStoredStaffProfile } from './lib/staffSession';
import { testScenarios } from './testStudio';
import type { JobCard, JobSummary, PricingProfile, StaffProfile } from './types';

type Tab = 'queue' | 'setup' | 'tests';

const ONBOARDING_APP_URL = import.meta.env.VITE_ONBOARDING_APP_URL?.trim();

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value?: string) {
  if (!value) {
    return 'TBD';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function queueTone(status: JobSummary['status']) {
  switch (status) {
    case 'quoted':
      return 'accent';
    case 'booked':
      return 'good';
    case 'needs_follow_up':
      return 'warn';
    default:
      return 'neutral';
  }
}

function calendarSetupLabel(value: boolean) {
  return value ? 'Mapped' : 'Needs mapping';
}

function profileCompletionScore(staff: StaffProfile | null) {
  if (!staff) {
    return { ready: 0, total: 3 };
  }

  const checks = [
    staff.voiceConsentStatus === 'granted',
    Boolean(staff.calendarConnection?.connectedAt),
    Boolean(staff.pricingProfile),
  ];

  return {
    ready: checks.filter(Boolean).length,
    total: checks.length,
  };
}

function createPricingDraft(staff?: StaffProfile | null): PricingProfile {
  return {
    baseCalloutFee: staff?.pricingProfile?.baseCalloutFee ?? 180,
    minimumJobPrice: staff?.pricingProfile?.minimumJobPrice ?? 160,
    hourlyRate: staff?.pricingProfile?.hourlyRate ?? 145,
    rushMultiplier: staff?.pricingProfile?.rushMultiplier ?? 1.35,
    complexityMultiplier: staff?.pricingProfile?.complexityMultiplier ?? 1.2,
    confidenceFloor: staff?.pricingProfile?.confidenceFloor ?? 0.68,
  };
}

function createCalendarDraft(staff?: StaffProfile | null) {
  return {
    accountEmail: staff?.calendarConnection?.accountEmail ?? staff?.email ?? '',
    calendarId: staff?.calendarConnection?.calendarId ?? staff?.outlookCalendarId ?? '',
    timezone: staff?.calendarConnection?.timezone ?? staff?.timezone ?? 'Australia/Sydney',
  };
}

function AppShell({
  staff,
  sessionToken,
  onSignOut,
}: {
  staff: StaffProfile;
  sessionToken: string;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<Tab>('queue');
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const selectedJobIdRef = useRef<string | null>(null);
  const [selectedJobCard, setSelectedJobCard] = useState<JobCard | null>(null);
  const [jobCardLoading, setJobCardLoading] = useState(false);
  const [jobCardError, setJobCardError] = useState<string | null>(null);
  const [profile, setProfile] = useState(staff);
  const [calendarDraft, setCalendarDraft] = useState(() => createCalendarDraft(staff));
  const [pricingDraft, setPricingDraft] = useState(() => createPricingDraft(staff));
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState<'voice' | 'calendar' | 'pricing' | null>(null);
  const [copiedScenarioId, setCopiedScenarioId] = useState<string | null>(null);

  const completion = profileCompletionScore(profile);
  const queuedCallbacks = useMemo(() => jobs.filter((job) => job.callback).length, [jobs]);

  useEffect(() => {
    setCalendarDraft(createCalendarDraft(profile));
    setPricingDraft(createPricingDraft(profile));
  }, [profile]);

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId;
  }, [selectedJobId]);

  async function reloadProfile() {
    try {
      const nextProfile = await getStaffProfile(sessionToken);
      setProfile(nextProfile);
      updateStoredStaffProfile(nextProfile);
      return nextProfile;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        onSignOut();
      }
      throw error;
    }
  }

  async function loadJobs(nextSelectedId?: string | null) {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const nextJobs = await getStaffJobs(sessionToken);
      setJobs(nextJobs);
      const fallbackId = nextSelectedId ?? selectedJobIdRef.current ?? nextJobs[0]?.id ?? null;
      setSelectedJobId(fallbackId);
      return nextJobs;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        onSignOut();
        return [];
      }
      setJobsError(error instanceof Error ? error.message : 'Unable to load queue');
      return [];
    } finally {
      setJobsLoading(false);
    }
  }

  useEffect(() => {
    void loadJobs();
    const timer = window.setInterval(() => {
      void loadJobs();
    }, 30000);

    return () => {
      window.clearInterval(timer);
    };
  }, [sessionToken]);

  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJobCard(null);
      return;
    }

    let active = true;
    const load = async () => {
      setJobCardLoading(true);
      setJobCardError(null);
      try {
        const card = await getJobCard(sessionToken, selectedJobId);
        if (!active) {
          return;
        }
        setSelectedJobCard(card);
      } catch (error) {
        if (!active) {
          return;
        }
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          onSignOut();
          return;
        }
        setSelectedJobCard(null);
        setJobCardError(error instanceof Error ? error.message : 'Unable to load job card');
      } finally {
        if (active) {
          setJobCardLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [onSignOut, selectedJobId, sessionToken]);

  async function runSetupAction(action: 'voice' | 'calendar' | 'pricing', callback: () => Promise<StaffProfile>) {
    setSetupBusy(action);
    setSetupError(null);
    setSetupMessage(null);
    try {
      const nextProfile = await callback();
      setProfile(nextProfile);
      updateStoredStaffProfile(nextProfile);
      setSetupMessage(
        action === 'voice'
          ? 'Voice consent updated.'
          : action === 'calendar'
            ? 'Calendar mapping saved.'
            : 'Pricing profile saved.',
      );
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        onSignOut();
        return;
      }
      setSetupError(error instanceof Error ? error.message : 'Unable to save setup details');
    } finally {
      setSetupBusy(null);
    }
  }

  async function copyScenarioPrompt(id: string, prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedScenarioId(id);
      window.setTimeout(() => {
        setCopiedScenarioId((current) => (current === id ? null : current));
      }, 1800);
    } catch {
      setCopiedScenarioId(null);
    }
  }

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null;

  return (
    <div className="shell">
      <div className="container">
        <header className="hero hero--staff">
          <div className="hero-copy">
            <div className="eyebrow">Staff Console</div>
            <h1>Queue, setup, and test flows from a phone-sized Cloudflare surface.</h1>
            <p>
              This Pages app replaces the iOS pilot for now. It keeps auth, setup completion, live jobs, and a test
              scenario deck in one surface.
            </p>
          </div>

          <div className="hero-card">
            <span className="pill accent">Signed in</span>
            <strong>{profile.fullName}</strong>
            <p className="muted">
              {profile.role ?? 'Staff'}{profile.companyName ? ` · ${profile.companyName}` : ''}{' '}
              {profile.timezone ? `· ${profile.timezone}` : ''}
            </p>
            <div className="hero-metrics">
              <div>
                <span className="metric-label">Queue</span>
                <strong>{jobs.length}</strong>
              </div>
              <div>
                <span className="metric-label">Setup</span>
                <strong>
                  {completion.ready}/{completion.total}
                </strong>
              </div>
            </div>
          </div>
        </header>

        <section className="topbar">
          <div className="topbar-copy">
            <strong>{profile.fullName}</strong>
            <span className="muted">
              Voice consent {profile.voiceConsentStatus} · Calendar {calendarSetupLabel(Boolean(profile.calendarConnection?.connectedAt))}
            </span>
          </div>
          <div className="topbar-stats">
            <div className="mini-stat">
              <span className="muted">Open jobs</span>
              <strong>{jobs.length}</strong>
            </div>
            <div className="mini-stat">
              <span className="muted">Callbacks</span>
              <strong>{queuedCallbacks}</strong>
            </div>
            <div className="mini-stat">
              <span className="muted">Pricing</span>
              <strong>{profile.pricingProfile ? formatCurrency(profile.pricingProfile.baseCalloutFee) : 'Unset'}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="button secondary" type="button" onClick={() => void reloadProfile()}>
              Refresh profile
            </button>
            <button className="button secondary" type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </section>

        <nav className="tabbar" aria-label="Staff app sections">
          <button className={`tab ${tab === 'queue' ? 'active' : ''}`} type="button" onClick={() => setTab('queue')}>
            Queue
          </button>
          <button className={`tab ${tab === 'setup' ? 'active' : ''}`} type="button" onClick={() => setTab('setup')}>
            Setup
          </button>
          <button className={`tab ${tab === 'tests' ? 'active' : ''}`} type="button" onClick={() => setTab('tests')}>
            Test Studio
          </button>
        </nav>

        {tab === 'queue' ? (
          <section className="staff-grid">
            <div className="card">
              <div className="card-inner">
                <div className="section-header">
                  <div className="eyebrow">Job queue</div>
                  <h2>Live jobs assigned to this staff session</h2>
                  <p className="muted">Tap a card to open the full job bundle from the Worker.</p>
                </div>
                {jobsError ? <p className="pill warn">{jobsError}</p> : null}
                {jobsLoading ? <div className="empty-state">Loading queue…</div> : null}
                {!jobsLoading && jobs.length === 0 ? (
                  <div className="empty-state">
                    <strong>No jobs assigned yet.</strong>
                    <p className="muted">Calls routed to this staff profile will show up here.</p>
                  </div>
                ) : null}
                <div className="job-list">
                  {jobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      className={`job-card ${selectedJobId === job.id ? 'selected' : ''}`}
                      onClick={() => setSelectedJobId(job.id)}
                    >
                      <div className="job-card-head">
                        <div>
                          <strong>{job.customerName}</strong>
                          <div className="muted">{job.suburb}</div>
                        </div>
                        <span className={`pill ${queueTone(job.status)}`}>{job.status.replace(/_/g, ' ')}</span>
                      </div>
                      <p>{job.summary}</p>
                      <div className="job-card-meta">
                        <span>{formatCurrency(job.quote.presentedPrice)}</span>
                        <span>{job.updatedAt}</span>
                        <span>{job.photos.length} photos</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-inner">
                <div className="section-header">
                  <div className="eyebrow">Job card</div>
                  <h2>{selectedJob?.customerName ?? 'Select a job'}</h2>
                  <p className="muted">
                    Full job summary, quote trail, appointment context, photos, and call history.
                  </p>
                </div>

                {jobCardLoading ? <div className="empty-state">Loading job card…</div> : null}
                {jobCardError ? <p className="pill warn">{jobCardError}</p> : null}

                {!jobCardLoading && !selectedJobCard ? (
                  <div className="empty-state">
                    <strong>No job selected.</strong>
                    <p className="muted">Choose a job from the queue to inspect the current card.</p>
                  </div>
                ) : null}

                {selectedJobCard ? (
                  <div className="detail-stack">
                    <div className="detail-panel">
                      <div className="detail-grid">
                        <div>
                          <span className="label">Customer</span>
                          <strong>{selectedJobCard.job.callerName ?? 'Unknown caller'}</strong>
                        </div>
                        <div>
                          <span className="label">Phone</span>
                          <strong>{selectedJobCard.job.callerPhone ?? 'Unknown phone'}</strong>
                        </div>
                        <div>
                          <span className="label">Address</span>
                          <strong>{selectedJobCard.job.address ?? 'TBD'}</strong>
                        </div>
                        <div>
                          <span className="label">Appointment</span>
                          <strong>{formatDateTime(selectedJobCard.job.appointment?.startAt)}</strong>
                        </div>
                      </div>
                      <p className="detail-summary">{selectedJobCard.job.summary ?? selectedJobCard.job.issue ?? 'Awaiting call summary'}</p>
                    </div>

                    <div className="detail-panel">
                      <h3>Quote trail</h3>
                      {selectedJobCard.quotes.length ? (
                        <div className="quote-list">
                          {selectedJobCard.quotes.map((quote) => (
                            <div className="quote-item" key={quote.id}>
                              <strong>{formatCurrency(quote.amount)}</strong>
                              <span className="muted">
                                {quote.variant} · {quote.status}
                              </span>
                              <small>{quote.rationale[0] ?? 'No rationale recorded.'}</small>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state compact">No explicit quote trail yet.</div>
                      )}
                    </div>

                    <div className="detail-panel">
                      <h3>Photos</h3>
                      {selectedJobCard.photos.length ? (
                        <div className="photo-grid">
                          {selectedJobCard.photos.map((photo) => (
                            <div key={photo.id} className="photo-thumb">
                              <ProtectedImage
                                photoId={photo.id}
                                sessionToken={sessionToken}
                                alt={photo.caption ?? photo.filename}
                              />
                              <span>{photo.caption ?? photo.filename}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state compact">No photos attached yet.</div>
                      )}
                    </div>

                    <div className="detail-panel">
                      <h3>Call history</h3>
                      {selectedJobCard.calls.length ? (
                        <div className="call-list">
                          {selectedJobCard.calls.map((call) => (
                            <div className="call-item" key={call.id}>
                              <strong>{call.status.replace(/_/g, ' ')}</strong>
                              <span className="muted">{formatDateTime(call.createdAt)}</span>
                              <p>{call.summary ?? call.transcript ?? 'No summary captured yet.'}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-state compact">No call logs captured yet.</div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {tab === 'setup' ? (
          <section className="setup-grid">
            <div className="card">
              <div className="card-inner">
                <div className="section-header">
                  <div className="eyebrow">Readiness</div>
                  <h2>Finish the staff setup inside the browser</h2>
                  <p className="muted">This replaces the iOS setup path for now and hits the same Worker routes.</p>
                </div>
                <div className="readiness-list">
                  <div className="readiness-item">
                    <strong>Voice consent</strong>
                    <span className={`pill ${profile.voiceConsentStatus === 'granted' ? 'good' : 'warn'}`}>
                      {profile.voiceConsentStatus}
                    </span>
                  </div>
                  <div className="readiness-item">
                    <strong>Calendar connection</strong>
                    <span className={`pill ${profile.calendarConnection?.connectedAt ? 'good' : 'warn'}`}>
                      {profile.calendarConnection?.connectedAt ? 'mapped' : 'pending'}
                    </span>
                  </div>
                  <div className="readiness-item">
                    <strong>Pricing profile</strong>
                    <span className={`pill ${profile.pricingProfile ? 'good' : 'warn'}`}>
                      {profile.pricingProfile ? 'saved' : 'pending'}
                    </span>
                  </div>
                </div>
                {setupMessage ? <p className="pill good">{setupMessage}</p> : null}
                {setupError ? <p className="pill warn">{setupError}</p> : null}
              </div>
            </div>

            <div className="card">
              <div className="card-inner">
                <div className="section-header">
                  <div className="eyebrow">Voice</div>
                  <h2>Consent and cloning readiness</h2>
                </div>
                <p className="muted">
                  Record consent here so the agent profile is not blocked waiting for the legacy mobile surface.
                </p>
                <div className="action-row">
                  <button
                    className="button"
                    type="button"
                    onClick={() =>
                      void runSetupAction('voice', () =>
                        saveVoiceConsent(sessionToken, {
                          staffId: profile.id,
                          consent: profile.voiceConsentStatus !== 'granted',
                          signedBy: profile.fullName,
                        }),
                      )
                    }
                    disabled={setupBusy === 'voice'}
                  >
                    {setupBusy === 'voice'
                      ? 'Saving...'
                      : profile.voiceConsentStatus === 'granted'
                        ? 'Revoke consent'
                        : 'Grant consent'}
                  </button>
                  <span className="muted">Current status: {profile.voiceConsentStatus}</span>
                </div>
                {ONBOARDING_APP_URL ? (
                  <a className="inline-link" href={ONBOARDING_APP_URL} target="_blank" rel="noreferrer">
                    Open the dedicated onboarding Pages app
                  </a>
                ) : null}
              </div>
            </div>

            <div className="card">
              <div className="card-inner">
                <div className="section-header">
                  <div className="eyebrow">Calendar</div>
                  <h2>Store the Outlook calendar mapping placeholder</h2>
                </div>
                <p className="muted">
                  This saves the staff-side calendar details for now. It is not a live Outlook OAuth connection yet.
                </p>
                <form
                  className="stack"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runSetupAction('calendar', () =>
                      connectCalendar(sessionToken, {
                        staffId: profile.id,
                        ...calendarDraft,
                      }),
                    );
                  }}
                >
                  <label className="field">
                    <span>Account email</span>
                    <input
                      type="text"
                      value={calendarDraft.accountEmail}
                      onChange={(event) => setCalendarDraft((current) => ({ ...current, accountEmail: event.target.value }))}
                      placeholder="jordan@example.com"
                    />
                  </label>
                  <label className="field">
                    <span>Calendar label or ID</span>
                    <input
                      type="text"
                      value={calendarDraft.calendarId}
                      onChange={(event) => setCalendarDraft((current) => ({ ...current, calendarId: event.target.value }))}
                      placeholder="Jordan - TradieAI"
                    />
                  </label>
                  <label className="field">
                    <span>Timezone</span>
                    <input
                      type="text"
                      value={calendarDraft.timezone}
                      onChange={(event) => setCalendarDraft((current) => ({ ...current, timezone: event.target.value }))}
                      placeholder="Australia/Sydney"
                    />
                  </label>
                  <button className="button" type="submit" disabled={setupBusy === 'calendar'}>
                    {setupBusy === 'calendar' ? 'Saving...' : 'Save calendar mapping'}
                  </button>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-inner">
                <div className="section-header">
                  <div className="eyebrow">Pricing</div>
                  <h2>Set the staff pricing baseline</h2>
                </div>
                <form
                  className="stack"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runSetupAction('pricing', async () => {
                      const result = await savePricingInterview(sessionToken, {
                        staffId: profile.id,
                        responses: pricingDraft,
                      });
                      return {
                        ...result.staff,
                        pricingProfile: result.pricingProfile,
                      };
                    });
                  }}
                >
                  <div className="field-grid">
                    <label className="field">
                      <span>Base callout fee</span>
                      <input
                        type="number"
                        value={pricingDraft.baseCalloutFee}
                        onChange={(event) =>
                          setPricingDraft((current) => ({ ...current, baseCalloutFee: Number(event.target.value) || 0 }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Minimum job price</span>
                      <input
                        type="number"
                        value={pricingDraft.minimumJobPrice}
                        onChange={(event) =>
                          setPricingDraft((current) => ({ ...current, minimumJobPrice: Number(event.target.value) || 0 }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Hourly rate</span>
                      <input
                        type="number"
                        value={pricingDraft.hourlyRate}
                        onChange={(event) =>
                          setPricingDraft((current) => ({ ...current, hourlyRate: Number(event.target.value) || 0 }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Rush multiplier</span>
                      <input
                        type="number"
                        step="0.01"
                        value={pricingDraft.rushMultiplier}
                        onChange={(event) =>
                          setPricingDraft((current) => ({ ...current, rushMultiplier: Number(event.target.value) || 0 }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Complexity multiplier</span>
                      <input
                        type="number"
                        step="0.01"
                        value={pricingDraft.complexityMultiplier}
                        onChange={(event) =>
                          setPricingDraft((current) => ({ ...current, complexityMultiplier: Number(event.target.value) || 0 }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Confidence floor</span>
                      <input
                        type="number"
                        step="0.01"
                        value={pricingDraft.confidenceFloor}
                        onChange={(event) =>
                          setPricingDraft((current) => ({ ...current, confidenceFloor: Number(event.target.value) || 0 }))
                        }
                      />
                    </label>
                  </div>
                  <button className="button" type="submit" disabled={setupBusy === 'pricing'}>
                    {setupBusy === 'pricing' ? 'Saving...' : 'Save pricing profile'}
                  </button>
                </form>
              </div>
            </div>
          </section>
        ) : null}

        {tab === 'tests' ? (
          <section className="tests-grid">
            <div className="card">
              <div className="card-inner">
                <div className="section-header">
                  <div className="eyebrow">AI Test Studio</div>
                  <h2>Seed the judge loop before automation lands</h2>
                  <p className="muted">
                    This is the first deck for fixed prompts, adversarial scenarios, and explicit success criteria. The
                    next layer is the executor + third-model judge.
                  </p>
                </div>
                <div className="studio-summary">
                  <div className="mini-stat">
                    <span className="muted">Scenarios</span>
                    <strong>{testScenarios.length}</strong>
                  </div>
                  <div className="mini-stat">
                    <span className="muted">Judge model</span>
                    <strong>Planned</strong>
                  </div>
                  <div className="mini-stat">
                    <span className="muted">Target</span>
                    <strong>Voice agent</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="scenario-list">
              {testScenarios.map((scenario) => (
                <article className="card scenario-card" key={scenario.id}>
                  <div className="card-inner">
                    <div className="scenario-head">
                      <span className="pill accent">{scenario.category}</span>
                      <div className="scenario-actions">
                        {copiedScenarioId === scenario.id ? <span className="pill good">Copied</span> : null}
                        <button className="button secondary compact" type="button" onClick={() => void copyScenarioPrompt(scenario.id, scenario.prompt)}>
                          Copy prompt
                        </button>
                        <code>{scenario.id}</code>
                      </div>
                    </div>
                    <h3>{scenario.title}</h3>
                    <p className="muted">{scenario.objective}</p>

                    <div className="scenario-block">
                      <span className="label">Operator prompt</span>
                      <p>{scenario.prompt}</p>
                    </div>

                    <div className="scenario-block">
                      <span className="label">Success criteria</span>
                      <div className="judge-list">
                        {scenario.successCriteria.map((criterion) => (
                          <div className="judge-item" key={criterion.label}>
                            <strong>{criterion.label}</strong>
                            <p>{criterion.detail}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="scenario-block">
                      <span className="label">Judge notes</span>
                      <p>{scenario.judgeNotes}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (staff: StaffProfile, sessionToken: string, expiresAt: string) => void;
}) {
  const [inviteToken, setInviteToken] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [staffId, setStaffId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await verifyStaffOtp({
        inviteToken: inviteToken.trim(),
        otpCode: otpCode.trim(),
        staffId: staffId.trim() || undefined,
      });

      onAuthenticated(result.staff, result.session.token, result.session.expiresAt);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 404) {
        setError('Invite token or OTP did not match.');
      } else {
        setError(requestError instanceof Error ? requestError.message : 'Unable to verify staff session.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="shell auth-shell">
      <div className="container auth-container">
        <header className="hero hero--auth">
          <div className="hero-copy">
            <div className="eyebrow">Staff Access</div>
            <h1>Phone-first staff access while the native app waits.</h1>
            <p>
              Use the invite token and OTP from ops to open the staff queue, finish setup, and inspect live job cards
              from the Worker.
            </p>
          </div>
          <div className="hero-card">
            <span className="pill accent">Cloudflare Pages</span>
            <strong>Internal staff surface</strong>
            <p className="muted">Auth, queue, setup, and test scenarios in one browser app.</p>
          </div>
        </header>

        <div className="auth-grid">
          <div className="card">
            <div className="card-inner">
              <div className="section-header">
                <div className="eyebrow">Sign in</div>
                <h2>Verify the staff session</h2>
                <p className="muted">The Worker exchanges the invite token plus OTP for a staff session token.</p>
              </div>

              {error ? <p className="pill warn">{error}</p> : null}

              <form className="stack" onSubmit={submit}>
                <label className="field">
                  <span>Invite token</span>
                  <input
                    type="text"
                    value={inviteToken}
                    onChange={(event) => setInviteToken(event.target.value)}
                    placeholder="Paste the invite token"
                    autoCapitalize="off"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>

                <label className="field">
                  <span>OTP</span>
                  <input
                    type="text"
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value)}
                    placeholder="6 digit code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                  />
                </label>

                <label className="field">
                  <span>Staff ID (optional)</span>
                  <input
                    type="text"
                    value={staffId}
                    onChange={(event) => setStaffId(event.target.value)}
                    placeholder="Only needed for debugging or manual recovery"
                    autoCapitalize="off"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>

                <button className="button" type="submit" disabled={submitting || !inviteToken.trim() || !otpCode.trim()}>
                  {submitting ? 'Verifying...' : 'Open staff console'}
                </button>
              </form>
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <div className="card-inner">
                <div className="eyebrow">What this replaces</div>
                <h3>The iOS pilot surface</h3>
                <p className="muted">
                  This app is the temporary staff endpoint. It is optimized for phone width and hits the same Worker
                  state as the eventual native app.
                </p>
              </div>
            </div>

            <div className="card">
              <div className="card-inner">
                <div className="eyebrow">Included now</div>
                <div className="feature-list">
                  <div className="feature-item">
                    <strong>Live queue</strong>
                    <span className="muted">Staff-scoped jobs and detailed job cards.</span>
                  </div>
                  <div className="feature-item">
                    <strong>Setup completion</strong>
                    <span className="muted">Voice consent, calendar mapping, and pricing baseline.</span>
                  </div>
                  <div className="feature-item">
                    <strong>Test Studio seed</strong>
                    <span className="muted">Adversarial scenarios and judge criteria for the future loop.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [sessionToken, setSessionToken] = useState<string>('');
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [hydrating, setHydrating] = useState(() => Boolean(readStaffSession()));

  useEffect(() => {
    let active = true;
    const stored = readStaffSession();
    if (!stored) {
      setHydrating(false);
      return;
    }

    if (new Date(stored.expiresAt).getTime() <= Date.now()) {
      clearStaffSession();
      setHydrating(false);
      return;
    }

    const hydrate = async () => {
      try {
        const nextStaff = await getStaffProfile(stored.token);
        if (!active) {
          return;
        }
        setSessionToken(stored.token);
        setStaff(nextStaff);
        updateStoredStaffProfile(nextStaff);
      } catch {
        clearStaffSession();
        if (!active) {
          return;
        }
        setSessionToken('');
        setStaff(null);
      } finally {
        if (active) {
          setHydrating(false);
        }
      }
    };

    void hydrate();

    return () => {
      active = false;
    };
  }, []);

  function handleAuthenticated(nextStaff: StaffProfile, token: string, expiresAt: string) {
    saveStaffSession({ token, expiresAt, staffId: nextStaff.id }, { staff: nextStaff });
    setSessionToken(token);
    setStaff(nextStaff);
  }

  function signOut() {
    clearStaffSession();
    setSessionToken('');
    setStaff(null);
  }

  if (hydrating) {
    return (
      <div className="shell auth-shell">
        <div className="container">
          <div className="card">
            <div className="card-inner">Restoring the current tab's staff session…</div>
          </div>
        </div>
      </div>
    );
  }

  if (!staff || !sessionToken) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  return <AppShell staff={staff} sessionToken={sessionToken} onSignOut={signOut} />;
}
