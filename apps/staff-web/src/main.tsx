import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { resolveApiBaseUrl } from './api/baseUrl';
import './styles.css';

function primeCrossOriginConnection(baseUrl: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const origin = new URL(baseUrl, window.location.href).origin;
  if (!origin || origin === window.location.origin) {
    return;
  }

  const ensureLink = (rel: 'dns-prefetch' | 'preconnect') => {
    if (document.head.querySelector(`link[data-curve-origin="${origin}"][rel="${rel}"]`)) {
      return;
    }

    const link = document.createElement('link');
    link.rel = rel;
    link.href = origin;
    link.setAttribute('data-curve-origin', origin);
    if (rel === 'preconnect') {
      link.crossOrigin = 'anonymous';
    }
    document.head.appendChild(link);
  };

  ensureLink('dns-prefetch');
  ensureLink('preconnect');
}

primeCrossOriginConnection(resolveApiBaseUrl());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
