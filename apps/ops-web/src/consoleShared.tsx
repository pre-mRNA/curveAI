import { type FormEvent, type ReactNode, useCallback, useState } from 'react';
import { NavLink } from 'react-router-dom';

import { clearAdminToken, readAdminToken, saveAdminToken } from './lib/adminToken';
import { opsBrand, opsBrandStyle } from './brand';

export function SectionHeader({
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

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p className="muted">{description}</p>
    </div>
  );
}

export function LoadingPanel({
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

export function DashboardAuthPanel({
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
              type="password"
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

export function ConsoleLayout({
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
    <div className="shell dashboard-shell" style={opsBrandStyle}>
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

        <div className="topbar console-topbar">
          <div className="topbar-copy">
            <strong>{opsBrand.suiteName} {opsBrand.surfaceName}</strong>
            <span className="muted">{opsBrand.suiteTagline}. Ops dashboard, judged test studio, and live quote telemetry in one route family.</span>
          </div>
          <nav className="console-nav" aria-label="Console sections">
            <NavLink className={({ isActive }) => `console-link${isActive ? ' active' : ''}`} end to="/">
              Dashboard
            </NavLink>
            <NavLink className={({ isActive }) => `console-link${isActive ? ' active' : ''}`} to="/test-studio">
              AI Test Studio
            </NavLink>
          </nav>
          <div className="topbar-actions">
            <button className="button secondary" type="button" onClick={onSignOut} disabled={!storedToken}>
              Clear token
            </button>
          </div>
        </div>

        <div className="stack">{children}</div>
      </div>
    </div>
  );
}

export function useAdminTokenState() {
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
