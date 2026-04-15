import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { uploadBrand, uploadBrandStyle } from './brand';

const loadUploadPage = () => import('./UploadPage');
const UploadPage = lazy(loadUploadPage);

function UploadLanding() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUploadPage();
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <div className="shell" style={uploadBrandStyle}>
      <div className="container">
        <header className="hero hero--upload">
          <div className="hero-copy">
            <div className="eyebrow">{uploadBrand.eyebrow}</div>
            <h1>{uploadBrand.heroTitle}</h1>
            <p>{uploadBrand.heroDescription}</p>
          </div>
          <div className="hero-card">
            <span className="pill accent">{uploadBrand.badgeLabel}</span>
            <strong>{uploadBrand.badgeTitle}</strong>
            <p className="muted">{uploadBrand.badgeDescription}</p>
          </div>
        </header>

        <div className="upload-landing-grid">
          <div className="card">
            <div className="card-inner">
              <div className="section-label">How it works</div>
              <h2>Use your secure upload link from the SMS.</h2>
              <div className="landing-guide-list">
                <div className="landing-guide-item">
                  <strong>1. Open the message on your phone</strong>
                  <p className="muted">Tap the secure link from the tradie to open the live upload screen.</p>
                </div>
                <div className="landing-guide-item">
                  <strong>2. Add clear photos</strong>
                  <p className="muted">Send wide shots, close-ups, damage details, and anything that helps explain the job.</p>
                </div>
                <div className="landing-guide-item">
                  <strong>3. Submit everything in one go</strong>
                  <p className="muted">Your files are attached to the job card straight away so the tradie can review them fast.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-inner">
              <div className="section-label">Good photos help</div>
              <h2>Before you upload</h2>
              <ul className="tip-list">
                <li>Take one wider photo so the tradie can see the full area.</li>
                <li>Add close-up photos of leaks, damage, labels, or blocked parts.</li>
                <li>Use good light and keep the camera steady where possible.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="upload-wrap" style={uploadBrandStyle}>
      <div className="container">
        <div className="card upload-card">
          <div className="card-inner">
            <div className="eyebrow">Loading</div>
            <h1>Opening the secure upload link.</h1>
            <p className="muted">Loading the live photo-upload flow for this job.</p>
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
        <Route path="/" element={<UploadLanding />} />
        <Route path="/upload/:token" element={<UploadPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
