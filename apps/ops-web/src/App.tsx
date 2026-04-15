import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { apiClient, ApiError } from './api/client';
import { clearAdminToken, readAdminToken, saveAdminToken } from './lib/adminToken';
import type { DashboardPayload, JobSummary } from './types';

function statusTone(status: JobSummary['status']) {
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

function formatStatusLabel(value: string) {
  return value.replace(/_/g, ' ');
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(value);
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="section-header">
      {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      <div className="section-title-row">
        <h2>{title}</h2>
        {description ? <p className="muted">{description}</p> : null}
      </div>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p className="muted">{description}</p>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="card">
      <div className="card-inner">
        <SectionHeader eyebrow="Loading" title="Fetching live queue data" description="Waiting for the dashboard payload." />
        <div className="dashboard-stats">
          <div className="stat">
            <div className="skeleton stat-line" />
            <div className="skeleton stat-value" />
          </div>
          <div className="stat">
            <div className="skeleton stat-line" />
            <div className="skeleton stat-value" />
          </div>
          <div className="stat">
            <div className="skeleton stat-line" />
            <div className="skeleton stat-value" />
          </div>
        </div>
        <div className="skeleton job-skeleton" />
        <div className="skeleton job-skeleton" />
      </div>
    </div>
  );
}

function DashboardAuthPanel({
  tokenDraft,
  onTokenDraftChange,
  onSubmit,
  onClear,
  authError,
  loading,
}: {
  tokenDraft: string;
  onTokenDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
  authError: string | null;
  loading: boolean;
}) {
  return (
    <div className="card">
      <div className="card-inner">
        <div className="eyebrow">Restricted access</div>
        <h2>Sign in with your admin token.</h2>
        <p className="muted">The console only loads live data after authentication.</p>
        {authError ? <p className="pill warn">{authError}</p> : null}

        <form className="stack" onSubmit={onSubmit}>
          <label className="field" htmlFor="admin-token">
            <span>Admin token</span>
            <input
              id="admin-token"
              className="text-input"
              type="text"
              value={tokenDraft}
              onChange={(event) => onTokenDraftChange(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste token here"
            />
          </label>

          <div className="meta-row">
            <button className="button" type="submit" disabled={loading}>
              {loading ? 'Loading...' : 'Load dashboard'}
            </button>
            <button className="button secondary" type="button" onClick={onClear} disabled={loading}>
              Clear
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InternalDashboard() {
  const [storedToken, setStoredToken] = useState(() => readAdminToken());
  const [tokenDraft, setTokenDraft] = useState(() => readAdminToken());
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(storedToken));
  const [authError, setAuthError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let alive = true;

    if (!storedToken) {
      setLoading(false);
      setPayload(null);
      return () => {
        alive = false;
      };
    }

    const load = async () => {
      setLoading(true);
      setAuthError(null);
      setRequestError(null);

      try {
        const data = await apiClient.getDashboard(storedToken);
        if (!alive) {
          return;
        }
        setPayload(data);
      } catch (error) {
        if (!alive) {
          return;
        }

        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          clearAdminToken();
          setStoredToken('');
          setTokenDraft('');
          setPayload(null);
          setRequestError(null);
          setAuthError('Admin token rejected. Enter a valid token to continue.');
          return;
        }

        setPayload(null);
        setRequestError(error instanceof Error ? error.message : 'Unable to load dashboard');
      } finally {
        if (alive) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      alive = false;
    };
  }, [storedToken, retryNonce]);

  const activeJob = useMemo(() => payload?.jobs[0] ?? null, [payload]);
  const topStats = useMemo(
    () =>
      payload
        ? [
            { label: 'Jobs', value: payload.jobs.length.toString() },
            { label: 'Callbacks', value: payload.callbacks.length.toString() },
            { label: 'Experiments', value: payload.experiments.length.toString() },
            {
              label: 'Latest quote',
              value: activeJob ? formatCurrency(activeJob.quote.presentedPrice) : '—',
            },
          ]
        : [],
    [activeJob, payload],
  );

  const submitToken = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextToken = tokenDraft.trim();

    if (!nextToken) {
      setAuthError('Enter an admin token to load the dashboard.');
      setRequestError(null);
      return;
    }

    saveAdminToken(nextToken);
    setStoredToken(nextToken);
  };

  const clearToken = () => {
    clearAdminToken();
    setStoredToken('');
    setTokenDraft('');
    setPayload(null);
    setLoading(false);
    setAuthError(null);
    setRequestError(null);
  };

  return (
    <div className="shell dashboard-shell">
      <div className="container">
        <header className="hero hero--dashboard">
          <div className="hero-copy">
            <div className="eyebrow">Internal Ops Console</div>
            <h1>Live job control for calls, quotes, callbacks, and pricing tests.</h1>
            <p>Use an admin token to open the live queue. The layout stays readable on desktop and mobile.</p>
          </div>
          <div className="hero-card">
            <span className="pill accent">Private dashboard</span>
            <strong>Operational view</strong>
            <p className="muted">Queue status, pricing signals, and callback follow-up in one place.</p>
          </div>
        </header>

        <div className="topbar dashboard-topbar">
          <div className="topbar-copy">
            <strong>{storedToken ? 'Authenticated dashboard' : 'Admin token required'}</strong>
            <span className="muted">
              {storedToken ? 'Connected to live dashboard data.' : 'Enter your admin token to load the queue.'}
            </span>
          </div>
          <div className="topbar-stats">
            {topStats.map((stat) => (
              <div className="mini-stat" key={stat.label}>
                <span className="muted">{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
          <div className="topbar-actions">
            {storedToken ? (
              <>
                <button className="button secondary" type="button" onClick={() => setRetryNonce((value) => value + 1)}>
                  Refresh
                </button>
                <button className="button secondary" type="button" onClick={clearToken}>
                  Sign out
                </button>
              </>
            ) : null}
          </div>
        </div>

        {!storedToken ? (
          <DashboardAuthPanel
            tokenDraft={tokenDraft}
            onTokenDraftChange={setTokenDraft}
            onSubmit={submitToken}
            onClear={clearToken}
            authError={authError}
            loading={loading}
          />
        ) : null}

        {requestError ? (
          <div className="card">
            <div className="card-inner" role="alert">
              <div className="eyebrow">Dashboard request failed</div>
              <h2>Unable to load live data.</h2>
              <p className="muted">{requestError}</p>
            </div>
          </div>
        ) : null}

        {storedToken && loading ? <LoadingPanel /> : null}

        {storedToken && payload ? (
          <div className="dashboard-grid">
            <section className="stack">
              <div className="card">
                <div className="card-inner">
                  <SectionHeader
                    eyebrow="Queue"
                    title="Job summaries"
                    description="High-signal view of customer context, price, and follow-up status."
                  />
                  <div className="jobs">
                    {payload.jobs.length ? (
                      payload.jobs.map((job) => (
                        <article className="job" key={job.id}>
                          <div className="job-header">
                            <div>
                              <strong>{job.customerName}</strong>
                              <div className="muted">{job.suburb}</div>
                            </div>
                            <span className={`pill ${statusTone(job.status)}`}>{formatStatusLabel(job.status)}</span>
                          </div>
                          <p className="job-summary">{job.summary}</p>
                          <div className="meta-row">
                            <span className="pill">Quote {formatCurrency(job.quote.presentedPrice)}</span>
                            <span className="pill">Confidence {job.quote.confidence}</span>
                            <span className="pill">Updated {job.updatedAt}</span>
                          </div>
                          <div className="photo-row">
                            {job.photos.map((photo) => (
                              <figure className="photo" key={photo.id}>
                                <img src={photo.url} alt={photo.caption} />
                                <figcaption>{photo.caption}</figcaption>
                              </figure>
                            ))}
                          </div>
                          {job.callback ? <div className="pill warn">Callback: {job.callback.reason}</div> : null}
                        </article>
                      ))
                    ) : (
                      <EmptyState title="No jobs yet" description="When work lands, the live queue will appear here." />
                    )}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-inner">
                  <SectionHeader
                    eyebrow="Pricing"
                    title="Pricing experiments"
                    description="Monitor variant exposure and lift without digging through logs."
                  />
                  <div className="jobs">
                    {payload.experiments.length ? (
                      payload.experiments.map((experiment) => (
                        <div className="job" key={experiment.name}>
                          <div className="job-header">
                            <strong>{experiment.name}</strong>
                            <span className="pill">{experiment.variant}</span>
                          </div>
                          <div className="meta-row">
                            <span className="pill">{experiment.exposure}</span>
                            <span className="pill">{experiment.lift}</span>
                            <span className="pill">{experiment.sampleSize} samples</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <EmptyState title="No experiments" description="Pricing tests will show up here once they are active." />
                    )}
                  </div>
                </div>
              </div>
            </section>

            <aside className="stack">
              <div className="card">
                <div className="card-inner">
                  <SectionHeader eyebrow="Quote" title="Current quote state" description="Useful for quick sanity checks before you call back." />
                  {activeJob ? (
                    <div className="quote-grid">
                      <div className="stat">
                        <span className="muted">Base price</span>
                        <strong>{formatCurrency(activeJob.quote.basePrice)}</strong>
                      </div>
                      <div className="stat">
                        <span className="muted">Strategy adjustment</span>
                        <strong>{formatCurrency(activeJob.quote.strategyAdjustment)}</strong>
                      </div>
                      <div className="stat">
                        <span className="muted">Experiment adjustment</span>
                        <strong>{formatCurrency(activeJob.quote.experimentAdjustment)}</strong>
                      </div>
                      <div className="stat">
                        <span className="muted">Presented price</span>
                        <strong>{formatCurrency(activeJob.quote.presentedPrice)}</strong>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="No active job" description="The quote panel will lock onto the first live job in the queue." />
                  )}
                </div>
              </div>

              <div className="card">
                <div className="card-inner">
                  <SectionHeader eyebrow="Callbacks" title="Follow-up queue" description="Prioritise callers that need a manual touch." />
                  <div className="jobs">
                    {payload.callbacks.length ? (
                      payload.callbacks.map((callback) => (
                        <div className="job" key={callback.id}>
                          <div className="job-header">
                            <div>
                              <strong>{callback.customerName}</strong>
                              <div className="muted">{callback.phone}</div>
                            </div>
                            <span className={`pill ${callback.status === 'queued' ? 'warn' : 'good'}`}>
                              {formatStatusLabel(callback.status)}
                            </span>
                          </div>
                          <div className="job-summary">{callback.reason}</div>
                          <div className="meta-row">
                            <span className="pill">{callback.dueAt}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <EmptyState title="No callbacks" description="Completed follow-ups will disappear from this queue." />
                    )}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<InternalDashboard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
