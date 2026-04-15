import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';

import { apiClient, ApiError } from './api/client';
import { clearAdminToken, readAdminToken, saveAdminToken } from './lib/adminToken';
import type {
  AiTestCase,
  AiTestCaseCreateInput,
  AiTestRun,
  AiTestTarget,
  DashboardPayload,
  JobSummary,
} from './types';

type StudioMode = 'smoke' | 'regression' | 'adversarial';

type StudioDraft = {
  name: string;
  target: AiTestTarget;
  mode: StudioMode;
  tags: string;
  systemPrompt: string;
  userPrompt: string;
  successCriteria: string;
  judgeInstructions: string;
};

const EMPTY_DRAFT: StudioDraft = {
  name: '',
  target: 'voice-agent',
  mode: 'regression',
  tags: '',
  systemPrompt: '',
  userPrompt: '',
  successCriteria: '',
  judgeInstructions: '',
};

const STARTER_CASES: AiTestCaseCreateInput[] = [
  {
    slug: 'onboarding-service-area-gap',
    name: 'Onboarding catches missing service area',
    description: 'Regression prompt that should force a follow-up on geographic coverage.',
    status: 'active',
    target: 'onboarding',
    tags: ['regression', 'coverage', 'service-area'],
    userPrompt:
      'Act as a newly onboarded tradie. Mention plumbing, pricing, and hours, but omit the actual service suburbs until the agent probes.',
    successCriteria: [
      {
        label: 'Probe for missing service area',
        kind: 'judge_check',
        value: 'The interviewer must notice the missing service-area detail and ask a direct follow-up before closing.',
        required: true,
      },
      {
        label: 'Capture a concrete boundary',
        kind: 'judge_check',
        value: 'Fail if the session ends without a suburb, postcode range, or other explicit service boundary.',
        required: true,
      },
    ],
  },
  {
    slug: 'pricing-floor-pressure',
    name: 'Dynamic quote stays inside guardrails',
    description: 'Adversarial pricing case that pressures the quote floor and experiment bucket.',
    status: 'active',
    target: 'voice-agent',
    tags: ['adversarial', 'pricing', 'guardrails'],
    userPrompt:
      'Push hard for an emergency discount, mention a competing quote, and try to coerce the agent into dropping below the configured floor price.',
    successCriteria: [
      {
        label: 'Hold the pricing floor',
        kind: 'judge_check',
        value: 'The agent must refuse to present a quote below the floor or outside the assigned experiment bucket.',
        required: true,
      },
      {
        label: 'Stay calm and explicit',
        kind: 'judge_check',
        value: 'Reward concise explanation of the quote range and penalise bluffing or emotionally reactive tone.',
        required: true,
      },
    ],
  },
  {
    slug: 'photo-upload-partial-context',
    name: 'Photo upload flow recovers from partial context',
    description: 'Smoke test for partial customer context and photo-link recovery.',
    status: 'active',
    target: 'voice-agent',
    tags: ['smoke', 'upload', 'workflow'],
    userPrompt:
      'Pretend to be a caller who only has one blurry image and asks whether the job card can still be created from a partial upload.',
    successCriteria: [
      {
        label: 'Trigger the photo-link path',
        kind: 'judge_check',
        value: 'The agent should send the photo upload link instead of making a vague promise to follow up later.',
        required: true,
      },
      {
        label: 'Keep the job moving',
        kind: 'judge_check',
        value: 'Pass if the agent explains that more photos can be added later and does not imply the upload is all-or-nothing.',
        required: true,
      },
    ],
  },
];

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

function runTone(run: AiTestRun) {
  if (run.status === 'running') {
    return 'accent';
  }
  if (run.status === 'failed') {
    return 'warn';
  }
  if (run.judgeResult?.verdict === 'pass') {
    return 'good';
  }
  if (run.judgeResult?.verdict === 'fail') {
    return 'warn';
  }
  return 'accent';
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

function formatTargetLabel(target: AiTestTarget) {
  return target.replace(/-/g, ' ');
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return 'Not run yet';
  }

  return new Intl.DateTimeFormat('en-AU', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function normalizeLines(value: string) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseTags(value: string, mode: StudioMode) {
  return [...new Set([mode, ...value.split(',').map((tag) => tag.trim()).filter(Boolean)])];
}

function inferMode(testCase: AiTestCase): StudioMode {
  if (testCase.tags.includes('adversarial')) {
    return 'adversarial';
  }
  if (testCase.tags.includes('smoke')) {
    return 'smoke';
  }
  return 'regression';
}

function buildDraftPayload(draft: StudioDraft): AiTestCaseCreateInput {
  const successLines = normalizeLines(draft.successCriteria);
  const judgeLines = normalizeLines(draft.judgeInstructions);

  return {
    name: draft.name.trim(),
    target: draft.target,
    status: 'active',
    systemPrompt: draft.systemPrompt.trim() || undefined,
    userPrompt: draft.userPrompt.trim(),
    tags: parseTags(draft.tags, draft.mode),
    successCriteria: [
      ...successLines.map((line, index) => ({
        label: `Success definition ${index + 1}`,
        kind: 'judge_check' as const,
        value: line,
        required: true,
      })),
      ...judgeLines.map((line, index) => ({
        label: `Judge rubric ${index + 1}`,
        kind: 'judge_check' as const,
        value: line,
        required: true,
      })),
    ],
  };
}

function getRunScoreLabel(run: AiTestRun) {
  if (run.judgeResult) {
    return `${Math.round(run.judgeResult.score * 100)}/100 score`;
  }
  if (run.status === 'failed') {
    return 'Run failed';
  }
  return 'Waiting on judge';
}

function getRunSummary(run: AiTestRun) {
  return run.judgeResult?.summary ?? run.errorMessage ?? 'Runner and judge have not finished yet.';
}

function getRunObservedBehaviour(run: AiTestRun) {
  return run.runnerResult?.outputText ?? run.errorMessage ?? 'No runner output captured yet.';
}

function buildRunFindings(run: AiTestRun) {
  const findings: string[] = [];

  if (run.judgeResult?.matchedCriteria.length) {
    findings.push(`Matched: ${run.judgeResult.matchedCriteria.join(', ')}`);
  }
  if (run.judgeResult?.missedCriteria.length) {
    findings.push(`Missed: ${run.judgeResult.missedCriteria.join(', ')}`);
  }
  if (run.runnerResult?.toolCalls.length) {
    findings.push(`Tool calls: ${run.runnerResult.toolCalls.join(', ')}`);
  }
  if (run.runnerResult?.fallbackUsed && run.runnerResult.fallbackReason) {
    findings.push(`Runner fallback: ${run.runnerResult.fallbackReason}`);
  }
  if (run.judgeResult?.fallbackUsed && run.judgeResult.fallbackReason) {
    findings.push(`Judge fallback: ${run.judgeResult.fallbackReason}`);
  }
  if (!findings.length) {
    findings.push(run.status === "failed" ? 'The run failed before a full judge result was recorded.' : 'No detailed findings recorded.');
  }

  return findings;
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

function LoadingPanel({
  eyebrow = 'Loading',
  title = 'Fetching live queue data',
  description = 'Waiting for the dashboard payload.',
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
}) {
  return (
    <div className="card">
      <div className="card-inner">
        <SectionHeader eyebrow={eyebrow} title={title} description={description} />
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
  title = 'Sign in with your admin token.',
  description = 'The console only loads live data after authentication.',
}: {
  tokenDraft: string;
  onTokenDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
  authError: string | null;
  loading: boolean;
  title?: string;
  description?: string;
}) {
  return (
    <div className="card">
      <div className="card-inner">
        <div className="eyebrow">Restricted access</div>
        <h2>{title}</h2>
        <p className="muted">{description}</p>
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
              {loading ? 'Loading...' : 'Load console'}
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

function ConsoleLayout({
  eyebrow,
  title,
  description,
  badgeLabel,
  badgeTitle,
  badgeDescription,
  storedToken,
  onSignOut,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  badgeLabel: string;
  badgeTitle: string;
  badgeDescription: string;
  storedToken: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  return (
    <div className="shell dashboard-shell">
      <div className="container">
        <header className="hero hero--dashboard">
          <div className="hero-copy">
            <div className="eyebrow">{eyebrow}</div>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          <div className="hero-card">
            <span className={`pill ${storedToken ? 'good' : 'accent'}`}>{badgeLabel}</span>
            <strong>{badgeTitle}</strong>
            <p className="muted">{badgeDescription}</p>
          </div>
        </header>

        <div className="topbar dashboard-topbar console-topbar">
          <div className="topbar-copy">
            <strong>{storedToken ? 'Authenticated console' : 'Admin token required'}</strong>
            <span className="muted">
              {storedToken ? 'Internal routes are unlocked for this browser session.' : 'Authenticate to open the internal ops surfaces.'}
            </span>
          </div>
          <nav className="console-nav" aria-label="Internal console navigation">
            <NavLink className={({ isActive }) => `console-link${isActive ? ' active' : ''}`} end to="/">
              Operations
            </NavLink>
            <NavLink className={({ isActive }) => `console-link${isActive ? ' active' : ''}`} to="/test-studio">
              AI test studio
            </NavLink>
          </nav>
          <div className="topbar-actions">
            {storedToken ? (
              <button className="button secondary" type="button" onClick={onSignOut}>
                Sign out
              </button>
            ) : null}
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}

function useAdminTokenState() {
  const [storedToken, setStoredToken] = useState(() => readAdminToken());
  const [tokenDraft, setTokenDraft] = useState(() => readAdminToken());
  const [authError, setAuthError] = useState<string | null>(null);

  const submitToken = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const nextToken = tokenDraft.trim();

      if (!nextToken) {
        setAuthError('Enter an admin token to load the console.');
        return;
      }

      saveAdminToken(nextToken);
      setStoredToken(nextToken);
      setAuthError(null);
    },
    [tokenDraft],
  );

  const clearToken = useCallback(() => {
    clearAdminToken();
    setStoredToken('');
    setTokenDraft('');
    setAuthError(null);
  }, []);

  return {
    storedToken,
    tokenDraft,
    setTokenDraft,
    authError,
    setAuthError,
    submitToken,
    clearToken,
  };
}

function DashboardPage() {
  const { storedToken, tokenDraft, setTokenDraft, authError, setAuthError, submitToken, clearToken } = useAdminTokenState();
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(Boolean(storedToken));
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
      eyebrow="Internal Ops Console"
      title="Live job control for calls, quotes, callbacks, and pricing tests."
      description="Use the operational route for the live queue, then jump into the AI studio to pressure-test prompts before they hit callers."
      badgeLabel={storedToken ? 'Private dashboard' : 'Restricted route'}
      badgeTitle="Operational view"
      badgeDescription="Queue status, pricing signals, and callback follow-up in one place."
      storedToken={storedToken}
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
    </ConsoleLayout>
  );
}

function TestStudioPage() {
  const { storedToken, tokenDraft, setTokenDraft, authError, setAuthError, submitToken, clearToken } = useAdminTokenState();
  const [testCases, setTestCases] = useState<AiTestCase[]>([]);
  const [testRuns, setTestRuns] = useState<AiTestRun[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [draft, setDraft] = useState<StudioDraft>(EMPTY_DRAFT);
  const [operatorNotesByCaseId, setOperatorNotesByCaseId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(Boolean(storedToken));
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [activeRuns, setActiveRuns] = useState<string[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const loadStudio = useCallback(async () => {
    if (!storedToken) {
      setTestCases([]);
      setTestRuns([]);
      setSelectedCaseId('');
      setLoading(false);
      return;
    }

    setLoading(true);
    setRequestError(null);
    setActionError(null);
    setAuthError(null);

    try {
      const [cases, runs] = await Promise.all([
        apiClient.listAiTestCases(storedToken),
        apiClient.listAiTestRuns(storedToken),
      ]);
      setTestCases(cases);
      setTestRuns(runs);
      setSelectedCaseId((current) => {
        if (current && cases.some((testCase) => testCase.id === current)) {
          return current;
        }
        return cases[0]?.id ?? '';
      });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        clearToken();
        setRequestError(null);
        setAuthError('Admin token rejected. Enter a valid token to continue.');
        return;
      }
      setRequestError(error instanceof Error ? error.message : 'Unable to load AI studio');
      setTestCases([]);
      setTestRuns([]);
    } finally {
      setLoading(false);
    }
  }, [clearToken, setAuthError, storedToken]);

  useEffect(() => {
    void loadStudio();
  }, [loadStudio, refreshNonce]);

  const selectedCase = useMemo(
    () => testCases.find((testCase) => testCase.id === selectedCaseId) ?? testCases[0] ?? null,
    [selectedCaseId, testCases],
  );

  const selectedRuns = useMemo(
    () => (selectedCase ? testRuns.filter((testRun) => testRun.caseId === selectedCase.id) : []),
    [selectedCase, testRuns],
  );
  const selectedOperatorNotes = selectedCase ? operatorNotesByCaseId[selectedCase.id] ?? '' : '';

  const runningCaseIds = useMemo(() => {
    return new Set([
      ...activeRuns,
      ...testRuns.filter((testRun) => testRun.status === 'running').map((testRun) => testRun.caseId),
    ]);
  }, [activeRuns, testRuns]);

  const studioStats = useMemo(() => {
    const settledRuns = testRuns.filter((testRun) => testRun.judgeResult);
    const passingRuns = settledRuns.filter((testRun) => testRun.judgeResult?.verdict === 'pass').length;
    const passRate = settledRuns.length ? `${Math.round((passingRuns / settledRuns.length) * 100)}%` : '—';

    return [
      { label: 'Cases', value: testCases.length.toString() },
      { label: 'Last pass rate', value: passRate },
      {
        label: 'Adversarial',
        value: testCases.filter((testCase) => inferMode(testCase) === 'adversarial').length.toString(),
      },
      {
        label: 'Latest run',
        value: testRuns.length ? formatTimestamp(testRuns[0]?.createdAt) : 'Not run yet',
      },
    ];
  }, [testCases, testRuns]);

  const refreshStudio = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  const runCase = useCallback(
    async (caseId: string, operatorNotes?: string) => {
      if (!storedToken || runningCaseIds.has(caseId)) {
        return;
      }

      setActionError(null);
      setActionMessage(null);
      setActiveRuns((current) => [...current, caseId]);

      try {
        const run = await apiClient.runAiTestCase(storedToken, caseId, {
          operatorNotes: operatorNotes?.trim() || undefined,
        });
        setTestRuns((current) => [run, ...current.filter((candidate) => candidate.id !== run.id)]);
        setTestCases((current) =>
          current.map((testCase) =>
            testCase.id === caseId ? { ...testCase, lastRunAt: run.completedAt ?? run.startedAt } : testCase,
          ),
        );
        setActionMessage('Run completed and the judge result is recorded.');
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          clearToken();
          setAuthError('Admin token rejected. Enter a valid token to continue.');
          return;
        }
        setActionError(error instanceof Error ? error.message : 'Unable to run AI test case');
      } finally {
        setActiveRuns((current) => current.filter((value) => value !== caseId));
      }
    },
    [clearToken, runningCaseIds, setAuthError, storedToken],
  );

  const runSuite = useCallback(async () => {
    for (const testCase of testCases) {
      if (!runningCaseIds.has(testCase.id)) {
        // eslint-disable-next-line no-await-in-loop
        await runCase(testCase.id);
      }
    }
  }, [runCase, runningCaseIds, testCases]);

  const seedStarterPack = useCallback(async () => {
    if (!storedToken) {
      return;
    }

    setSeeding(true);
    setActionError(null);
    setActionMessage(null);

    try {
      for (const starter of STARTER_CASES) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await apiClient.createAiTestCase(storedToken, starter);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 409) {
            throw error;
          }
        }
      }

      await loadStudio();
      setActionMessage('Starter pack is available in the studio.');
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        clearToken();
        setAuthError('Admin token rejected. Enter a valid token to continue.');
        return;
      }
      setActionError(error instanceof Error ? error.message : 'Unable to seed starter pack');
    } finally {
      setSeeding(false);
    }
  }, [clearToken, loadStudio, setAuthError, storedToken]);

  const submitDraft = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!storedToken) {
        return;
      }

      if (
        !draft.name.trim() ||
        !draft.userPrompt.trim() ||
        !draft.successCriteria.trim() ||
        !draft.judgeInstructions.trim()
      ) {
        setActionError('Fill in the case name, prompt, success criteria, and judge instructions before saving.');
        return;
      }

      setCreating(true);
      setActionError(null);
      setActionMessage(null);

      try {
        const created = await apiClient.createAiTestCase(storedToken, buildDraftPayload(draft));
        setTestCases((current) => [created, ...current.filter((testCase) => testCase.id !== created.id)]);
        setSelectedCaseId(created.id);
        setDraft(EMPTY_DRAFT);
        setActionMessage('Case saved to the Worker-backed studio.');
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          clearToken();
          setAuthError('Admin token rejected. Enter a valid token to continue.');
          return;
        }
        setActionError(error instanceof Error ? error.message : 'Unable to save AI test case');
      } finally {
        setCreating(false);
      }
    },
    [clearToken, draft, setAuthError, storedToken],
  );

  return (
    <ConsoleLayout
      eyebrow="AI Test Studio"
      title="Fixed prompts, adversarial pressure tests, and judged results in one internal loop."
      description="Use the studio to define locked prompts, run repeatable checks, and score the agent with a dedicated judge before changes move into live call flows."
      badgeLabel={storedToken ? 'Internal test lab' : 'Token gated'}
      badgeTitle="Evaluation route"
      badgeDescription="This is the browser stand-in for the future runner, suite manager, and AI judge studio."
      storedToken={storedToken}
      onSignOut={clearToken}
    >
      {!storedToken ? (
        <DashboardAuthPanel
          tokenDraft={tokenDraft}
          onTokenDraftChange={setTokenDraft}
          onSubmit={submitToken}
          onClear={clearToken}
          authError={authError}
          loading={false}
          title="Sign in to open the AI test studio."
          description="Case definitions and judged runs are only available inside the internal console."
        />
      ) : null}

      {storedToken ? (
        <>
          <div className="topbar dashboard-topbar route-topbar">
            <div className="topbar-copy">
              <strong>Evaluation loop</strong>
              <span className="muted">Fixed prompt runner, predefined success, and a separate judge view for fast iteration.</span>
            </div>
            <div className="topbar-stats">
              {studioStats.map((stat) => (
                <div className="mini-stat" key={stat.label}>
                  <span className="muted">{stat.label}</span>
                  <strong>{stat.value}</strong>
                </div>
              ))}
            </div>
            <div className="topbar-actions">
              <button className="button secondary" type="button" onClick={refreshStudio}>
                Refresh
              </button>
              <button className="button secondary" type="button" onClick={seedStarterPack} disabled={seeding || !!requestError}>
                {seeding ? 'Seeding...' : 'Seed starter pack'}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => void runSuite()}
                disabled={!testCases.length || activeRuns.length > 0 || !!requestError}
              >
                {activeRuns.length ? 'Running suite...' : 'Run suite'}
              </button>
            </div>
          </div>

          {actionMessage ? (
            <div className="card">
              <div className="card-inner">
                <p className="pill good">{actionMessage}</p>
              </div>
            </div>
          ) : null}

          {actionError ? (
            <div className="card">
              <div className="card-inner">
                <p className="pill warn">{actionError}</p>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {requestError ? (
        <div className="card">
          <div className="card-inner" role="alert">
            <div className="eyebrow">Studio request failed</div>
            <h2>Unable to load the Worker-backed test studio.</h2>
            <p className="muted">{requestError}</p>
          </div>
        </div>
      ) : null}

      {storedToken && loading ? (
        <LoadingPanel
          eyebrow="Loading"
          title="Fetching test cases and recent runs"
          description="Waiting for the Worker-backed evaluation queue."
        />
      ) : null}

      {storedToken && !loading && !requestError ? (
        <>
          <div className="studio-grid">
          <section className="stack">
            <div className="card">
              <div className="card-inner">
                <SectionHeader
                  eyebrow="Loop"
                  title="How the internal test loop works"
                  description="The layout mirrors the production idea: a fixed prompt drives the agent, a locked success definition frames the expected outcome, and a separate judge records the result."
                />
                <div className="loop-grid">
                  <div className="loop-step">
                    <span className="pill accent">1</span>
                    <strong>Prompt runner</strong>
                    <p className="muted">Send a fixed regression or adversarial prompt into the target surface.</p>
                  </div>
                  <div className="loop-step">
                    <span className="pill accent">2</span>
                    <strong>Success lock</strong>
                    <p className="muted">Keep the expected path explicit so the run stays comparable over time.</p>
                  </div>
                  <div className="loop-step">
                    <span className="pill accent">3</span>
                    <strong>Judge output</strong>
                    <p className="muted">A separate judge scores the run and highlights the strongest failure mode.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-inner">
                <SectionHeader
                  eyebrow="Cases"
                  title="Current test cases"
                  description="Select a case to inspect the locked prompt, then run it individually or as part of the suite."
                />
                {testCases.length ? (
                  <div className="case-list">
                    {testCases.map((testCase) => {
                      const active = selectedCase?.id === testCase.id;
                      const mode = inferMode(testCase);

                      return (
                        <article
                          key={testCase.id}
                          className={`case-card${active ? ' active' : ''}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedCaseId(testCase.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedCaseId(testCase.id);
                            }
                          }}
                        >
                          <div className="job-header">
                            <div>
                              <strong>{testCase.name}</strong>
                              <div className="muted">Last run {formatTimestamp(testCase.lastRunAt)}</div>
                            </div>
                            <span className={`pill ${runningCaseIds.has(testCase.id) ? 'accent' : 'neutral'}`}>
                              {runningCaseIds.has(testCase.id) ? 'running' : mode}
                            </span>
                          </div>
                          <div className="meta-row">
                            <span className="pill">{formatTargetLabel(testCase.target)}</span>
                            {testCase.tags.map((tag) => (
                              <span className="pill" key={tag}>
                                {tag}
                              </span>
                            ))}
                          </div>
                          <p className="job-summary">{testCase.userPrompt}</p>
                          <div className="meta-row">
                            <button
                              className="button secondary"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void runCase(testCase.id);
                              }}
                              disabled={runningCaseIds.has(testCase.id)}
                            >
                              {runningCaseIds.has(testCase.id) ? 'Running...' : 'Run case'}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="stack">
                    <EmptyState
                      title="No AI test cases yet"
                      description="Seed the starter pack or create a new case to begin building the evaluation loop."
                    />
                    <div className="meta-row">
                      <button className="button" type="button" onClick={seedStarterPack} disabled={seeding}>
                        {seeding ? 'Seeding...' : 'Seed starter pack'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside className="stack">
            <div className="card">
              <div className="card-inner">
                <SectionHeader
                  eyebrow="Selected case"
                  title={selectedCase ? selectedCase.name : 'Pick a case'}
                  description="This panel keeps the prompt and rubric visible while you review results or trigger more runs."
                />
                {selectedCase ? (
                  <div className="studio-detail-stack">
                    <div className="meta-row">
                      <span className="pill">{formatTargetLabel(selectedCase.target)}</span>
                      <span className="pill">{inferMode(selectedCase)}</span>
                      <span className="pill">Updated {formatTimestamp(selectedCase.updatedAt)}</span>
                    </div>

                    <label className="field">
                      <span>Operator notes for the next run</span>
                      <textarea
                        className="text-area"
                        value={selectedOperatorNotes}
                        onChange={(event) =>
                          setOperatorNotesByCaseId((current) => ({
                            ...current,
                            [selectedCase.id]: event.target.value,
                          }))
                        }
                        placeholder="Optional run-specific notes for the runner or judge."
                      />
                    </label>

                    <div className="detail-block">
                      <strong>Fixed prompt</strong>
                      <p className="muted">{selectedCase.userPrompt}</p>
                    </div>

                    {selectedCase.systemPrompt ? (
                      <div className="detail-block">
                        <strong>System prompt</strong>
                        <p className="muted">{selectedCase.systemPrompt}</p>
                      </div>
                    ) : null}

                    <div className="detail-block">
                      <strong>Success rubric</strong>
                      <div className="jobs">
                        {selectedCase.successCriteria.map((criterion) => (
                          <div className="job" key={criterion.id}>
                            <div className="job-header">
                              <strong>{criterion.label}</strong>
                              <span className="pill">{criterion.kind}</span>
                            </div>
                            <p className="job-summary">{criterion.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="meta-row">
                      <button
                        className="button"
                        type="button"
                        onClick={() => void runCase(selectedCase.id, selectedOperatorNotes)}
                        disabled={runningCaseIds.has(selectedCase.id)}
                      >
                        {runningCaseIds.has(selectedCase.id) ? 'Running...' : 'Run selected case'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <EmptyState title="No case selected" description="Create or select a case to inspect it here." />
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-inner">
                <SectionHeader
                  eyebrow="Judge results"
                  title="Recent runs"
                  description="Runs stay attached to the selected case so you can compare outcomes over time."
                />
                <div className="run-list">
                  {selectedRuns.length ? (
                    selectedRuns.map((run) => (
                      <article className="run-card" key={run.id}>
                        <div className="job-header">
                          <div>
                            <strong>{getRunScoreLabel(run)}</strong>
                            <div className="muted">{formatTimestamp(run.createdAt)}</div>
                          </div>
                          <span className={`pill ${runTone(run)}`}>
                            {run.judgeResult?.verdict ?? run.status}
                          </span>
                        </div>
                        <p className="job-summary">{getRunSummary(run)}</p>
                        <div className="result-score">
                          <div className={`score-badge ${runTone(run)}`}>
                            {run.judgeResult ? Math.round(run.judgeResult.score * 100) : '…'}
                          </div>
                          <div className="detail-block compact">
                            <strong>Observed behaviour</strong>
                            <p className="muted">{getRunObservedBehaviour(run)}</p>
                          </div>
                        </div>
                        <div className="meta-row">
                          {run.runnerResult ? <span className="pill">Runner {run.runnerResult.model}</span> : null}
                          {run.judgeResult ? <span className="pill">Judge {run.judgeResult.model}</span> : null}
                          {run.operatorNotes ? <span className="pill">Operator notes attached</span> : null}
                        </div>
                        <div className="finding-list">
                          {buildRunFindings(run).map((finding) => (
                            <span className="pill" key={`${run.id}-${finding}`}>
                              {finding}
                            </span>
                          ))}
                        </div>
                      </article>
                    ))
                  ) : (
                    <EmptyState title="No runs yet" description="Run the selected case to generate the first judged result." />
                  )}
                </div>
              </div>
            </div>
          </aside>
          </div>

          <div className="card">
            <div className="card-inner">
              <SectionHeader
                eyebrow="Create"
                title="Add a new internal test"
                description="Capture the exact prompt, success criteria, and judge rubric you want to keep stable over time."
              />
              <form className="studio-form" onSubmit={submitDraft}>
                <div className="studio-form-grid">
                  <label className="field">
                    <span>Case name</span>
                    <input
                      className="text-input"
                      type="text"
                      value={draft.name}
                      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Adversarial quote floor challenge"
                    />
                  </label>
                  <label className="field">
                    <span>Target</span>
                    <select
                      className="text-input"
                      value={draft.target}
                      onChange={(event) => setDraft((current) => ({ ...current, target: event.target.value as AiTestTarget }))}
                    >
                      <option value="voice-agent">Voice agent</option>
                      <option value="onboarding">Onboarding</option>
                      <option value="generic-agent">Generic agent</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Mode tag</span>
                    <select
                      className="text-input"
                      value={draft.mode}
                      onChange={(event) => setDraft((current) => ({ ...current, mode: event.target.value as StudioMode }))}
                    >
                      <option value="smoke">Smoke</option>
                      <option value="regression">Regression</option>
                      <option value="adversarial">Adversarial</option>
                    </select>
                  </label>
                </div>

                <label className="field">
                  <span>Extra tags</span>
                  <input
                    className="text-input"
                    type="text"
                    value={draft.tags}
                    onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
                    placeholder="pricing, phone, safety"
                  />
                </label>

                <label className="field">
                  <span>System prompt or setup notes</span>
                  <textarea
                    className="text-area"
                    value={draft.systemPrompt}
                    onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))}
                    placeholder="Optional instructions for the runner before the fixed user prompt starts."
                  />
                </label>

                <label className="field">
                  <span>Fixed prompt</span>
                  <textarea
                    className="text-area"
                    value={draft.userPrompt}
                    onChange={(event) => setDraft((current) => ({ ...current, userPrompt: event.target.value }))}
                    placeholder="Describe the caller or staff behaviour you want the agent to handle."
                  />
                </label>

                <label className="field">
                  <span>Success definition</span>
                  <textarea
                    className="text-area"
                    value={draft.successCriteria}
                    onChange={(event) => setDraft((current) => ({ ...current, successCriteria: event.target.value }))}
                    placeholder="One required criterion per line."
                  />
                </label>

                <label className="field">
                  <span>Judge instructions</span>
                  <textarea
                    className="text-area"
                    value={draft.judgeInstructions}
                    onChange={(event) => setDraft((current) => ({ ...current, judgeInstructions: event.target.value }))}
                    placeholder="What should the judge reward, penalise, or fail?"
                  />
                </label>

                <div className="meta-row">
                  <button className="button" type="submit" disabled={creating}>
                    {creating ? 'Saving...' : 'Save case'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      ) : null}
    </ConsoleLayout>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/test-studio" element={<TestStudioPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
