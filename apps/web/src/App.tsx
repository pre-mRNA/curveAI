import { FormEvent, Suspense, lazy, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import { onboardingBrand, onboardingBrandStyle } from './brand';

const loadOnboardingPage = () => import('./onboarding/OnboardingPage');
const OnboardingPage = lazy(loadOnboardingPage);

function OnboardingLanding() {
  const navigate = useNavigate();
  const [inviteCode, setInviteCode] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOnboardingPage();
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
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
        <header className="hero landing-hero">
          <div className="eyebrow">{onboardingBrand.eyebrow}</div>
          <h1>{onboardingBrand.heroTitle}</h1>
          <p>{onboardingBrand.heroDescription}</p>
          <div className="meta-row">
            <span className="pill accent">About 10 minutes</span>
            <span className="pill">Secure invite</span>
            <span className="pill">Phone or desktop</span>
          </div>
        </header>

        <div className="grid onboarding-grid landing-grid">
          <section className="stack">
            <div className="card">
              <div className="card-inner onboarding-stage">
                <div className="eyebrow">What happens next</div>
                <h2>Follow the guided setup from start to finish.</h2>
                <div className="landing-step-grid">
                  <div className="landing-step-card">
                    <span className="landing-step-number">1</span>
                    <strong>Consent</strong>
                    <div className="muted">Confirm the recording, cloning, and profile permissions before anything starts.</div>
                  </div>
                  <div className="landing-step-card">
                    <span className="landing-step-number">2</span>
                    <strong>Interview and review</strong>
                    <div className="muted">Answer the setup interview, then check the extracted profile before it goes live.</div>
                  </div>
                  <div className="landing-step-card">
                    <span className="landing-step-number">3</span>
                    <strong>Calendar and voice setup</strong>
                    <div className="muted">Connect the working calendar and record a clean sample for voice cloning.</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-inner onboarding-stage">
                <div className="eyebrow">Open the session</div>
                <h2>Already have your invite code?</h2>
                <p className="muted">
                  Paste it here to jump straight into the secure onboarding flow in this browser.
                </p>
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
                    <button className="button" type="submit" disabled={!inviteCode.trim()}>
                      Open onboarding
                    </button>
                    <span className="muted">Keep the same tab open until onboarding is complete.</span>
                  </div>
                </form>
              </div>
            </div>
          </section>

          <aside className="stack">
            <div className="card">
              <div className="card-inner onboarding-sidebar">
                <div className="eyebrow">{onboardingBrand.surfaceName}</div>
                <h3>Come in with the basics, not a perfect script.</h3>
                <ul className="guide-list">
                  <li>Your service areas, job types, and any work you do not want the agent handling.</li>
                  <li>Your usual quoting style, pricing guardrails, and when callbacks are required.</li>
                  <li>Calendar access and a quiet spot for the clean voice sample.</li>
                </ul>
              </div>
            </div>

            <div className="card">
              <div className="card-inner onboarding-sidebar">
                <div className="eyebrow">{onboardingBrand.badgeLabel}</div>
                <h3>This flow is designed to finish in one sitting.</h3>
                <p className="muted">
                  Your secure invite opens one browser session. Stay on the same tab while you move through interview,
                  review, calendar, and voice setup.
                </p>
                <ul className="guide-list compact">
                  <li>Microphone access is only needed for the clean voice sample step.</li>
                  <li>If you stop halfway through, return to the same browser and invite link.</li>
                  <li>Nothing starts until the consent boxes are checked.</li>
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
            <h2>Opening the secure onboarding flow.</h2>
            <p className="muted">Pulling the full interview and review experience into this tab.</p>
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
