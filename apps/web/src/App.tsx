import { FormEvent, Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import { scheduleBrowserWarmup } from '../../../packages/shared/src/browserWarmup';
import { onboardingBrand, onboardingBrandStyle } from './brand';

const loadOnboardingPage = () => import('./onboarding/OnboardingPage');
const OnboardingPage = lazy(loadOnboardingPage);

function OnboardingLanding() {
  const navigate = useNavigate();
  const [inviteCode, setInviteCode] = useState('');

  useEffect(() => {
    const cleanup = scheduleBrowserWarmup(() => {
      void loadOnboardingPage();
    });

    return cleanup;
  }, []);

  const submitInviteCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextCode = inviteCode.trim();
    if (!nextCode) {
      return;
    }
    navigate(`/onboard/${encodeURIComponent(nextCode)}`);
  };

  return (
    <div className="shell onboarding-shell landing-shell" style={onboardingBrandStyle}>
      <div className="container">
        <header className="hero landing-hero landing-hero-grid">
          <div className="landing-hero-copy">
            <div className="eyebrow">{onboardingBrand.eyebrow}</div>
            <h1>{onboardingBrand.heroTitle}</h1>
            <p>{onboardingBrand.heroDescription}</p>
            <div className="meta-row">
              <span className="pill accent">10 minutes</span>
              <span className="pill">Private link</span>
              <span className="pill">Best done in one go</span>
            </div>
          </div>

          <div className="landing-hero-panel">
            <div className="eyebrow">Before you start</div>
            <h2>Have these three things ready.</h2>
            <ul className="guide-list compact">
              <li>Know the jobs you take and the jobs you do not want.</li>
              <li>Know your normal pricing and when the assistant should ask you first.</li>
              <li>Have your calendar handy and find a quiet spot for the voice sample.</li>
            </ul>
          </div>
        </header>

        <div className="grid onboarding-grid landing-grid">
          <section className="stack">
            <div className="card card--primary">
              <div className="card-inner onboarding-stage">
                <div className="eyebrow">Open the session</div>
                <h2>Start with your invite code.</h2>
                <p className="muted">Paste the code from your text or email. If you already started, use the same browser and link again.</p>
                <form className="invite-entry-form" onSubmit={submitInviteCode}>
                  <label className="field" htmlFor="landing-invite-code">
                    <span>Invite code</span>
                    <input
                      id="landing-invite-code"
                      type="text"
                      value={inviteCode}
                      onChange={(event) => setInviteCode(event.target.value)}
                      onFocus={() => {
                        void loadOnboardingPage();
                      }}
                      placeholder="Paste invite code"
                      autoCapitalize="off"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <div className="invite-entry-row">
                    <button
                      className="button"
                      type="submit"
                      disabled={!inviteCode.trim()}
                      onPointerEnter={() => {
                        void loadOnboardingPage();
                      }}
                    >
                      Start setup
                    </button>
                    <span className="muted">Works on your phone or computer.</span>
                  </div>
                </form>
              </div>
            </div>

            <div className="card">
              <div className="card-inner onboarding-stage">
                <div className="eyebrow">What happens next</div>
                <h2>Three quick steps.</h2>
                <p className="muted">This private link sets up how the assistant talks, books, and handles your jobs.</p>
                <div className="landing-step-grid">
                  <div className="landing-step-card">
                    <span className="landing-step-number">1</span>
                    <div>
                      <strong>Say yes</strong>
                      <div className="muted">Tick the boxes so setup can start.</div>
                    </div>
                  </div>
                  <div className="landing-step-card">
                    <span className="landing-step-number">2</span>
                    <div>
                      <strong>Answer questions</strong>
                      <div className="muted">Tell us how you work and check the details.</div>
                    </div>
                  </div>
                  <div className="landing-step-card">
                    <span className="landing-step-number">3</span>
                    <div>
                      <strong>Calendar and voice</strong>
                      <div className="muted">Connect your calendar and record your voice.</div>
                    </div>
                  </div>
                </div>
                <div className="landing-assurance-row">
                  <span className="pill">Check details before finish</span>
                  <span className="pill">Calendar opens in a new tab</span>
                  <span className="pill">You only record at the voice step</span>
                </div>
              </div>
            </div>
          </section>

          <aside className="stack">
            <div className="card">
              <div className="card-inner onboarding-sidebar">
                <div className="eyebrow">{onboardingBrand.surfaceName}</div>
                <h3>What you will set up.</h3>
                <ul className="guide-list">
                  <li>The jobs you want and the jobs you do not want.</li>
                  <li>Your normal pricing and when the assistant should ask you first.</li>
                  <li>Your calendar so bookings land in the right place.</li>
                </ul>
              </div>
            </div>

            <div className="card">
              <div className="card-inner onboarding-sidebar">
                <div className="eyebrow">What you get</div>
                <h3>By the end of setup.</h3>
                <p className="muted">The assistant will be much closer to how you actually work.</p>
                <ul className="guide-list compact">
                  <li>It knows the jobs you take and the ones you avoid.</li>
                  <li>It can book into the calendar you connect here.</li>
                  <li>It can use your voice sample so it sounds more like you.</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="shell onboarding-shell" style={onboardingBrandStyle}>
      <div className="container">
        <div className="card">
          <div className="card-inner onboarding-stage">
            <div className="eyebrow">Loading</div>
            <h2>Opening setup.</h2>
            <p className="muted">Loading the next page.</p>
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
        <Route path="/" element={<OnboardingLanding />} />
        <Route path="/onboard/:inviteCode" element={<OnboardingPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
