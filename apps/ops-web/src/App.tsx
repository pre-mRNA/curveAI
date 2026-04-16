import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { scheduleBrowserWarmup } from '../../../packages/shared/src/browserWarmup';
import { apiClient, ApiError } from './api/client';
import { opsBrand, opsBrandStyle } from './brand';
import {
  ConsoleLayout,
  DashboardAuthPanel,
  EmptyState,
  LoadingPanel,
  SectionHeader,
  useAdminTokenState,
} from './consoleShared';
import { ProtectedImage } from './ProtectedImage';
import type { DashboardPayload, JobSummary } from './types';

const loadTestStudioPage = () => import('./TestStudioPage');
const TestStudioPage = lazy(loadTestStudioPage);

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
  return value.replace(/[_-]/g, ' ');
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(value);
}

function DashboardPage() {
  const { storedToken, tokenDraft, setTokenDraft, authError, setAuthError, submitToken, clearToken } = useAdminTokenState();
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(storedToken));
  const [requestError, setRequestError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!storedToken) {
      return undefined;
    }

    const cleanup = scheduleBrowserWarmup(() => {
      void loadTestStudioPage();
    }, { timeout: 1500 });

    return cleanup;
  }, [storedToken]);

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
          clearToken();
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
  }, [clearToken, setAuthError, storedToken, retryNonce]);

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

  return (
    <ConsoleLayout
      eyebrow={opsBrand.eyebrow}
      title={opsBrand.heroTitle}
      description={opsBrand.heroDescription}
      badgeLabel={storedToken ? opsBrand.badgeLabel : 'Restricted route'}
      badgeTitle={opsBrand.badgeTitle}
      badgeDescription={opsBrand.badgeDescription}
      storedToken={storedToken}
      onWarmTestStudio={() => {
        void loadTestStudioPage();
      }}
      onSignOut={clearToken}
    >
      {!storedToken ? (
        <DashboardAuthPanel
          tokenDraft={tokenDraft}
          onTokenDraftChange={setTokenDraft}
          onSubmit={submitToken}
          onClear={clearToken}
          authError={authError}
          loading={loading}
          title="Sign in with your admin token."
          description="The dashboard only loads live queue data after authentication."
        />
      ) : null}

      {storedToken ? (
        <div className="topbar dashboard-topbar route-topbar">
          <div className="topbar-copy">
            <strong>Operational queue</strong>
            <span className="muted">Live jobs, callbacks, and quote signals from the current worker control plane.</span>
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
            <button className="button secondary" type="button" onClick={() => setRetryNonce((value) => value + 1)}>
              Refresh
            </button>
          </div>
        </div>
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
                              <ProtectedImage photoId={photo.id} adminToken={storedToken} alt={photo.caption} />
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
    </ConsoleLayout>
  );
}

function RouteFallback() {
  return (
    <div className="shell dashboard-shell" style={opsBrandStyle}>
      <div className="container">
        <div className="card">
          <div className="card-inner">
            <div className="eyebrow">Loading</div>
            <h2>Opening the requested console route.</h2>
            <p className="muted">Pulling the heavier internal tools into the browser only when they are needed.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/test-studio" element={<TestStudioPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
