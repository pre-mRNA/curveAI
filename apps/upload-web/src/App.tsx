import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { scheduleBrowserWarmup } from '../../../packages/shared/src/browserWarmup';
import { uploadBrand, uploadBrandStyle } from './brand';

const loadUploadPage = () => import('./UploadPage');
const UploadPage = lazy(loadUploadPage);

function UploadLanding() {
  useEffect(() => {
    const cleanup = scheduleBrowserWarmup(() => {
      void loadUploadPage();
    });

    return cleanup;
  }, []);

  return (
    <div className="shell" style={uploadBrandStyle}>
      <div className="container">
        <header className="hero hero--upload">
          <div className="hero-copy">
            <div className="eyebrow">{uploadBrand.eyebrow}</div>
            <h1>{uploadBrand.heroTitle}</h1>
            <p>{uploadBrand.heroDescription}</p>
            <div className="meta-row">
              <span className="pill accent">Under 2 minutes</span>
              <span className="pill">Private text link</span>
              <span className="pill">Phone friendly</span>
            </div>
            <div className="hero-callout">
              Open the text from your tradie or office, tap the link, and send the photos from your phone.
            </div>
          </div>
          <div className="hero-card hero-card--practical">
            <div className="section-label">What to send</div>
            <strong>Start wide, then show the problem close up.</strong>
            <ul className="tip-list compact">
              <li>Show the whole area first.</li>
              <li>Then show the leak, damage, label, or blocked part.</li>
              <li>Send a few photos together if you can.</li>
            </ul>
          </div>
        </header>

        <div className="upload-landing-grid">
          <div className="card card--primary">
            <div className="card-inner">
              <div className="section-label">How it works</div>
              <h2>Open the link from the text and send the photos.</h2>
              <p className="muted">The link only works for the job in that message, so it is safe to send the photos there.</p>
              <div className="landing-guide-list">
                <div className="landing-guide-item">
                  <strong>1. Open the text on your phone</strong>
                  <p className="muted">Tap the link from the tradie or office to open the photo page.</p>
                </div>
                <div className="landing-guide-item">
                  <strong>2. Add a few clear photos</strong>
                  <p className="muted">Take one wide photo, then close-ups of the problem.</p>
                </div>
                <div className="landing-guide-item">
                  <strong>3. Send them all together</strong>
                  <p className="muted">The tradie gets the photos straight away.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-inner">
              <div className="section-label">Before you start</div>
              <h2>Why this helps</h2>
              <ul className="tip-list">
                <li>The page shows who asked for the photos and what job they are for.</li>
                <li>Good photos can help the tradie quote the job before they arrive.</li>
                <li>They can also help the tradie bring the right parts the first time.</li>
              </ul>
              <p className="muted">A few clear photos now usually saves time later.</p>
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
            <h1>Opening your photo link.</h1>
            <p className="muted">Getting the upload page ready.</p>
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
