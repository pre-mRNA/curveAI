import { FormEvent, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import OnboardingPage from './onboarding/OnboardingPage';

function OnboardingLanding() {
  const navigate = useNavigate();
  const [inviteCode, setInviteCode] = useState('');

  const submitInviteCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextCode = inviteCode.trim();
    if (!nextCode) {
      return;
    }
    navigate(`/onboard/${encodeURIComponent(nextCode)}`);
  };

  return (
    <div className="shell onboarding-shell landing-shell">
      <div className="container">
        <header className="hero landing-hero">
          <div className="eyebrow">Public Onboarding</div>
          <h1>Structured voice onboarding for tradies.</h1>
          <p>
            Open the secure invite link to start the guided onboarding flow. It collects consent, interview
            answers, extraction review, calendar connection, and a clean voice sample in one session.
          </p>
          <div className="meta-row">
            <span className="pill accent">Invite-gated</span>
            <span className="pill">Browser voice</span>
            <span className="pill">Resume-friendly</span>
          </div>
        </header>

        <div className="grid onboarding-grid landing-grid">
          <section className="stack">
            <div className="card">
              <div className="card-inner onboarding-stage">
                <div className="eyebrow">What happens next</div>
                <h2>Keep the invite link handy and follow the guided steps.</h2>
                <div className="landing-step-grid">
                  <div className="landing-step-card">
                    <span className="landing-step-number">1</span>
                    <strong>Consent</strong>
                    <div className="muted">Check the recording, cloning, and data-processing permissions to unlock the session.</div>
                  </div>
                  <div className="landing-step-card">
                    <span className="landing-step-number">2</span>
                    <strong>Interview and review</strong>
                    <div className="muted">Capture the structured interview, then verify the extracted profile before it becomes canonical.</div>
                  </div>
                  <div className="landing-step-card">
                    <span className="landing-step-number">3</span>
                    <strong>Calendar and voice setup</strong>
                    <div className="muted">Connect the staff calendar and upload a clean voice sample for cloning.</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-inner onboarding-stage">
                <div className="eyebrow">Open the session</div>
                <h2>Paste the invite code to continue or resume onboarding.</h2>
                <p className="muted">
                  If someone opens the onboarding Pages hostname directly, they can still recover the live flow from here.
                </p>
                <form className="invite-entry-form" onSubmit={submitInviteCode}>
                  <label className="field" htmlFor="landing-invite-code">
                    <span>Invite code</span>
                    <input
                      id="landing-invite-code"
                      type="text"
                      value={inviteCode}
                      onChange={(event) => setInviteCode(event.target.value)}
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
                    <span className="muted">The same invite can resume an in-progress session on this device.</span>
                  </div>
                </form>
              </div>
            </div>
          </section>

          <aside className="stack">
            <div className="card">
              <div className="card-inner onboarding-sidebar">
                <div className="eyebrow">Before you start</div>
                <h3>Use the invite path from a desktop or mobile browser.</h3>
                <ul className="guide-list">
                  <li>Have microphone access ready for the voice sample.</li>
                  <li>Finish the consent boxes before starting the interview.</li>
                  <li>Return to the same invite to resume the session later.</li>
                </ul>
              </div>
            </div>

            <div className="card">
              <div className="card-inner onboarding-sidebar">
                <div className="eyebrow">Route</div>
                <h3>Use the invite path</h3>
                <p className="muted">
                  The onboarding app runs at <code>/onboard/:inviteCode</code>. Invalid or missing invite codes will
                  not start a session.
                </p>
                <div className="meta-row">
                  <span className="pill accent">Invite-gated</span>
                  <span className="pill">Browser voice</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<OnboardingLanding />} />
      <Route path="/onboard/:inviteCode" element={<OnboardingPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
