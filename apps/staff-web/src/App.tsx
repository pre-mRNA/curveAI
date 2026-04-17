import { FormEvent, Suspense, lazy, useEffect, useState } from 'react';
import { scheduleBrowserWarmup } from '../../../packages/shared/src/browserWarmup';
import { ApiError, getStaffProfile, signOutStaff, verifyStaffOtp } from './api/client';
import { staffBrand, staffBrandStyle } from './brand';
import { clearProtectedImageCache } from './ProtectedImage';
import type { StaffProfile } from './types';

const loadStaffShell = () => import('./StaffShell');
const StaffShell = lazy(loadStaffShell);

function AuthScreen({
  onAuthenticated,
  initialError,
  preloadShell,
}: {
  onAuthenticated: (staff: StaffProfile) => void;
  initialError?: string | null;
  preloadShell: () => Promise<unknown>;
}) {
  const [inviteToken, setInviteToken] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    void preloadShell();

    try {
      const nextStaff = await verifyStaffOtp({
        inviteToken: inviteToken.trim(),
        otpCode: otpCode.trim(),
      });

      onAuthenticated(nextStaff);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 404) {
        setError('Invite code or 6 digit code is wrong.');
      } else {
        setError(requestError instanceof Error ? requestError.message : 'Could not sign you in.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="shell auth-shell" style={staffBrandStyle}>
      <div className="container auth-container">
        <header className="hero hero--auth">
          <div className="hero-copy">
            <div className="eyebrow">{staffBrand.eyebrow}</div>
            <h1>Open your jobs on this phone.</h1>
            <p>Use your invite code and 6 digit code to sign in.</p>
          </div>
          <div className="hero-card">
            <span className="pill accent">{staffBrand.badgeLabel}</span>
            <strong>{staffBrand.badgeTitle}</strong>
            <p className="muted">{staffBrand.badgeDescription}</p>
          </div>
        </header>

        <div className="auth-grid">
          <div className="card">
            <div className="card-inner">
              <div className="section-header">
                <div className="eyebrow">Sign in</div>
                <h2>Sign in</h2>
                <p className="muted">Enter your invite code and 6 digit code.</p>
              </div>

              {error || initialError ? <p className="pill warn">{error ?? initialError}</p> : null}

              <form className="stack" onSubmit={submit}>
                <label className="field">
                  <span>Invite code</span>
                  <input
                    type="text"
                    value={inviteToken}
                    onChange={(event) => setInviteToken(event.target.value)}
                    onFocus={() => {
                      void preloadShell();
                    }}
                    placeholder="Paste the invite code"
                    autoCapitalize="off"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>

                <label className="field">
                  <span>6 digit code</span>
                  <input
                    type="text"
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value)}
                    onFocus={() => {
                      void preloadShell();
                    }}
                    placeholder="6 digit code"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                  />
                </label>

                <button className="button" type="submit" disabled={submitting || !inviteToken.trim() || !otpCode.trim()}>
                  {submitting ? 'Signing in...' : 'Open jobs'}
                </button>
              </form>
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <div className="card-inner">
                <div className="eyebrow">Field surface</div>
                <h3>Phone job page</h3>
                <p className="muted">
                  This page is made for quick job checks on a phone.
                </p>
              </div>
            </div>

            <div className="card">
              <div className="card-inner">
                <div className="eyebrow">Included now</div>
                <div className="feature-list">
                  <div className="feature-item">
                    <strong>Jobs</strong>
                    <span className="muted">See your jobs and open the details.</span>
                  </div>
                  <div className="feature-item">
                    <strong>Setup</strong>
                    <span className="muted">Start or resume the private setup flow.</span>
                  </div>
                  <div className="feature-item">
                    <strong>Tests</strong>
                    <span className="muted">Try prompts and test the assistant.</span>
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
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const [hydrating, setHydrating] = useState(true);
  const [hydrateError, setHydrateError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const hydrate = async () => {
      try {
        const nextStaff = await getStaffProfile();
        if (!active) {
          return;
        }
        void loadStaffShell();
        setHydrateError(null);
        setStaff(nextStaff);
      } catch (requestError) {
        if (!active) {
          return;
        }
        if (requestError instanceof ApiError && (requestError.status === 401 || requestError.status === 403)) {
          setHydrateError(null);
        } else {
          setHydrateError('Could not reach your jobs right now. Try again in a moment.');
        }
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

  useEffect(() => {
    if (staff) {
      return undefined;
    }

    const cleanup = scheduleBrowserWarmup(() => {
      void loadStaffShell();
    });
    return cleanup;
  }, [staff]);

  function handleAuthenticated(nextStaff: StaffProfile) {
    void loadStaffShell();
    setHydrateError(null);
    setStaff(nextStaff);
  }

  async function signOut() {
    await signOutStaff().catch(() => undefined);
    clearProtectedImageCache();
    setHydrateError(null);
    setStaff(null);
  }

  if (hydrating) {
    return (
      <div className="shell auth-shell" style={staffBrandStyle}>
        <div className="container">
          <div className="card">
            <div className="card-inner">
              <div className="eyebrow">Staff session</div>
              <h1>Checking if you are already signed in.</h1>
              <p className="muted">Loading your jobs.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!staff) {
    return <AuthScreen onAuthenticated={handleAuthenticated} initialError={hydrateError} preloadShell={loadStaffShell} />;
  }

  return (
    <Suspense
      fallback={
        <div className="shell auth-shell" style={staffBrandStyle}>
          <div className="container">
            <div className="card">
              <div className="card-inner">
                <div className="eyebrow">Staff session</div>
                <h1>Opening your jobs.</h1>
                <p className="muted">Loading the phone view.</p>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <StaffShell staff={staff} onSignOut={() => void signOut()} />
    </Suspense>
  );
}
