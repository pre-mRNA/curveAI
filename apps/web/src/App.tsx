import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { apiClient, ApiError } from './api/client';
import { clearAdminToken, readAdminToken, saveAdminToken } from './lib/adminToken';
import { PHOTO_UPLOAD_ACCEPT, isSupportedPhotoFile } from './lib/upload';
import OnboardingPage from './onboarding/OnboardingPage';
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

function LoadingPanel() {
  return (
    <div className="card">
      <div className="card-inner">
        <div className="skeleton" style={{ height: 24, width: '40%', borderRadius: 12 }} />
        <div style={{ height: 14 }} />
        <div className="skeleton" style={{ height: 96, width: '100%', borderRadius: 16 }} />
        <div style={{ height: 12 }} />
        <div className="skeleton" style={{ height: 96, width: '100%', borderRadius: 16 }} />
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
    <div className="card auth-card">
      <div className="card-inner auth-grid">
        <div className="auth-copy">
          <div className="eyebrow">Restricted access</div>
          <h2>Sign in with your admin token.</h2>
          <p className="muted">
            The console only loads live data after authentication. No fallback dashboard is shown here.
          </p>
          {authError ? <p className="pill warn auth-message">{authError}</p> : null}
        </div>

        <form className="auth-form" onSubmit={onSubmit}>
          <label className="field" htmlFor="admin-token">
            <span>Admin token</span>
            <input
              id="admin-token"
              className="text-input"
              type="password"
              value={tokenDraft}
              onChange={(event) => onTokenDraftChange(event.target.value)}
              autoComplete="current-password"
              spellCheck={false}
              placeholder="Paste token here"
            />
          </label>

          <div className="inline-actions">
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
    <div className="shell">
      <div className="container">
        <header className="hero">
          <div className="eyebrow">Internal Ops Console</div>
          <h1>Card-based job control for calls, quotes, callbacks, and pricing tests.</h1>
          <p>
            Use an admin token to open the live queue. The console shows only real API data, not placeholder
            fallback content.
          </p>
        </header>

        <div className="topbar">
          <div>
            <strong>{storedToken ? 'Authenticated dashboard' : 'Admin token required'}</strong>
            <span className="muted">
              {storedToken ? 'Connected to live dashboard data.' : 'Enter your admin token to load the queue.'}
            </span>
          </div>
          <div className="meta-row">
            {payload ? <span className="pill accent">{payload.jobs.length} jobs</span> : null}
            {payload ? <span className="pill good">{payload.callbacks.length} callbacks</span> : null}
            {payload ? <span className="pill warn">{payload.experiments.length} pricing tests</span> : null}
          </div>
          <div className="inline-actions">
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
          <>
            <div style={{ height: 18 }} />
            <DashboardAuthPanel
              tokenDraft={tokenDraft}
              onTokenDraftChange={setTokenDraft}
              onSubmit={submitToken}
              onClear={clearToken}
              authError={authError}
              loading={loading}
            />
          </>
        ) : null}

        {requestError ? (
          <>
            <div style={{ height: 18 }} />
            <div className="card error-card">
              <div className="card-inner auth-grid">
                <div>
                  <div className="eyebrow">Dashboard request failed</div>
                  <h2>Unable to load live data.</h2>
                  <p className="muted">{requestError}</p>
                </div>
                <div className="inline-actions">
                  <button className="button" type="button" onClick={() => setRetryNonce((value) => value + 1)}>
                    Retry
                  </button>
                  <button className="button secondary" type="button" onClick={clearToken}>
                    Re-enter token
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {storedToken && loading ? (
          <>
            <div style={{ height: 18 }} />
            <LoadingPanel />
          </>
        ) : null}

        {storedToken && payload ? (
          <>
            <div style={{ height: 18 }} />
            <div className="grid dashboard-grid">
              <section className="stack">
                <div className="card">
                  <div className="card-inner">
                    <h2>Job summaries</h2>
                    <div className="jobs">
                      {payload.jobs.map((job) => (
                        <article className="job" key={job.id}>
                          <div className="job-header">
                            <div>
                              <strong>{job.customerName}</strong>
                              <div className="muted">{job.suburb}</div>
                            </div>
                            <span className={`pill ${statusTone(job.status)}`}>{job.status.replace('_', ' ')}</span>
                          </div>
                          <div>{job.summary}</div>
                          <div className="meta-row">
                            <span className="pill">Quote ${job.quote.presentedPrice}</span>
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
                      ))}
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-inner">
                    <h3>Pricing experiments</h3>
                    <div className="table">
                      {payload.experiments.map((experiment) => (
                        <div className="table-row" key={experiment.name}>
                          <strong>{experiment.name}</strong>
                          <span className="muted">{experiment.variant}</span>
                          <span>{experiment.exposure}</span>
                          <span>{experiment.lift}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <aside className="stack">
                <div className="card">
                  <div className="card-inner">
                    <h3>Quote state</h3>
                    {activeJob ? (
                      <div className="quote-grid">
                        <div className="stat">
                          <span className="muted">Base price</span>
                          <strong>${activeJob.quote.basePrice}</strong>
                        </div>
                        <div className="stat">
                          <span className="muted">Strategy adjustment</span>
                          <strong>${activeJob.quote.strategyAdjustment}</strong>
                        </div>
                        <div className="stat">
                          <span className="muted">Experiment adjustment</span>
                          <strong>${activeJob.quote.experimentAdjustment}</strong>
                        </div>
                        <div className="stat">
                          <span className="muted">Presented price</span>
                          <strong>${activeJob.quote.presentedPrice}</strong>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="card">
                  <div className="card-inner">
                    <h3>Callbacks</h3>
                    <div className="jobs">
                      {payload.callbacks.map((callback) => (
                        <div className="job" key={callback.id}>
                          <div className="job-header">
                            <div>
                              <strong>{callback.customerName}</strong>
                              <div className="muted">{callback.phone}</div>
                            </div>
                            <span className={`pill ${callback.status === 'queued' ? 'warn' : 'good'}`}>
                              {callback.status}
                            </span>
                          </div>
                          <div>{callback.reason}</div>
                          <div className="meta-row">
                            <span className="pill">{callback.dueAt}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function UploadPage() {
  const { token = '' } = useParams();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSelect = (files: FileList | null) => {
    const nextFiles = files ? Array.from(files) : [];
    setMessage(null);
    setError(null);

    if (nextFiles.some((file) => !isSupportedPhotoFile(file))) {
      setSelectedFiles([]);
      setError('Only image files are accepted.');
      return;
    }

    setSelectedFiles(nextFiles);
  };

  const onUpload = async () => {
    if (!selectedFiles.length) {
      setError('Choose at least one image.');
      return;
    }

    if (selectedFiles.some((file) => !isSupportedPhotoFile(file))) {
      setError('Only image files are accepted.');
      return;
    }

    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      const result = await apiClient.uploadPhotos(token, selectedFiles);
      setMessage(`Uploaded ${result.uploaded} photo${result.uploaded === 1 ? '' : 's'} successfully.`);
      setSelectedFiles([]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-wrap">
      <div className="card upload-card">
        <div className="card-inner">
          <div className="eyebrow">Customer Upload</div>
          <h1>Send your photos to the tradie.</h1>
          <p className="muted">
            Reference token: <code>{token || 'missing'}</code>
          </p>

          <div className="dropzone">
            <div>
              <strong>Upload images from the job site</strong>
              <div className="muted">PNG, JPG, JPEG, HEIC, HEIF, or WebP images only.</div>
            </div>
            <label className="field upload-input" htmlFor="upload-files">
              <span>Photo files</span>
              <input
                id="upload-files"
                type="file"
                accept={PHOTO_UPLOAD_ACCEPT}
                multiple
                onChange={(event) => onSelect(event.target.files)}
              />
            </label>
            <button className="button" type="button" onClick={onUpload} disabled={uploading}>
              {uploading ? 'Uploading...' : 'Upload photos'}
            </button>
          </div>

          <div style={{ height: 14 }} />

          <div className="field">
            <label>Selected files</label>
            <div className="card" style={{ background: 'rgba(255,255,255,0.65)' }}>
              <div className="card-inner">
                {selectedFiles.length ? (
                  selectedFiles.map((file) => <div key={file.name}>{file.name}</div>)
                ) : (
                  <div className="muted">No files selected yet.</div>
                )}
              </div>
            </div>
          </div>

          {message ? <p className="pill good">{message}</p> : null}
          {error ? <p className="pill warn">{error}</p> : null}

          <p className="muted">
            Your files are posted to <code>/uploads/:token/photos</code> on the configured API base URL.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<InternalDashboard />} />
      <Route path="/onboard/:inviteCode" element={<OnboardingPage />} />
      <Route path="/upload/:token" element={<UploadPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
