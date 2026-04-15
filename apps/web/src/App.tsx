import { Navigate, Route, Routes } from 'react-router-dom';
import OnboardingPage from './onboarding/OnboardingPage';

function OnboardingLanding() {
  return (
    <div className="shell">
      <div className="container">
        <header className="hero">
          <div className="eyebrow">Public Onboarding</div>
          <h1>Structured voice onboarding for tradies.</h1>
          <p>
            Open the secure invite link to start the voice interview, extraction review, calendar connection, and
            voice sample workflow.
          </p>
        </header>

        <div className="grid onboarding-grid">
          <section className="stack">
            <div className="card">
              <div className="card-inner onboarding-stage">
                <div className="eyebrow">How it works</div>
                <h2>One secure invite opens the full onboarding flow.</h2>
                <div className="jobs">
                  <div className="job">
                    <strong>1. Consent</strong>
                    <div className="muted">Confirm recording, clone, and data processing permissions.</div>
                  </div>
                  <div className="job">
                    <strong>2. Interview and review</strong>
                    <div className="muted">Capture the structured voice interview and review the extracted profile.</div>
                  </div>
                  <div className="job">
                    <strong>3. Calendar and voice setup</strong>
                    <div className="muted">Connect the staff calendar and upload a clean voice sample for cloning.</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <aside className="stack">
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
