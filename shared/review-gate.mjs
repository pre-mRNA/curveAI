const COOKIE_NAME = "curve_review_gate";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const HTML_GATE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

async function signPayload(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (value) => value.toString(16).padStart(2, "0")).join("");
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(
    (cookieHeader ?? "")
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");
        return separator >= 0 ? [entry.slice(0, separator), entry.slice(separator + 1)] : [entry, ""];
      }),
  );
}

function isAssetPath(pathname) {
  return pathname.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(pathname);
}

function sanitizeRedirect(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function isLocalHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function applySharedHeaders(headers) {
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
}

function renderGatePage({ actionPath, redirectTo, invalidPasscode }) {
  const escapedRedirect = redirectTo.replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Curve AI Review Access</title>
    <style>
      :root { color-scheme: light; font-family: "Avenir Next", "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at top, #eef7ff, #dfe7f1 58%, #f6f3ee); color: #15202b; }
      .panel { width: min(420px, calc(100vw - 32px)); border-radius: 28px; padding: 28px; background: rgba(255,255,255,0.86); box-shadow: 0 22px 60px rgba(23,36,54,0.14); backdrop-filter: blur(16px); }
      .eyebrow { display: inline-flex; padding: 6px 10px; border-radius: 999px; background: #dbeafe; color: #1d4ed8; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
      h1 { margin: 16px 0 12px; font-size: 28px; line-height: 1.1; }
      p { margin: 0 0 16px; color: #516071; line-height: 1.5; }
      label { display: grid; gap: 8px; font-weight: 600; color: #243140; }
      input { width: 100%; box-sizing: border-box; border: 1px solid rgba(21,32,43,0.14); border-radius: 16px; padding: 14px 16px; font: inherit; background: rgba(255,255,255,0.92); }
      button { width: 100%; margin-top: 16px; border: 0; border-radius: 16px; padding: 14px 16px; font: inherit; font-weight: 700; color: white; background: linear-gradient(135deg, #2563eb, #0f766e); cursor: pointer; }
      .error { margin: 12px 0 0; color: #b91c1c; font-weight: 600; }
      .hint { margin-top: 18px; font-size: 13px; color: #64748b; }
    </style>
  </head>
  <body>
    <main class="panel">
      <div class="eyebrow">Review Access</div>
      <h1>Protected staging build</h1>
      <p>Enter the review passcode to unlock this Curve AI preview.</p>
      <form method="post" action="${actionPath}">
        <input type="hidden" name="redirect" value="${escapedRedirect}" />
        <label>
          Passcode
          <input type="password" name="passcode" autocomplete="current-password" autofocus required />
        </label>
        <button type="submit">Unlock preview</button>
      </form>
      ${invalidPasscode ? '<p class="error">Passcode did not match.</p>' : ""}
      <p class="hint">This gate sits in front of the static Pages app so the site is not public while under review.</p>
    </main>
  </body>
</html>`;
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const passcode = context.env.REVIEW_PASSCODE?.trim();
  const cookieSecret = (context.env.REVIEW_COOKIE_SECRET ?? context.env.REVIEW_PASSCODE ?? "").trim();
  if (!passcode || !cookieSecret) {
    if (isLocalHost(url.hostname)) {
      return context.next();
    }
    const response = new Response("Review protection is not configured for this Pages app.", {
      status: 503,
      headers: {
        "cache-control": "private, no-store",
      },
    });
    applySharedHeaders(response.headers);
    return response;
  }
  const cookies = parseCookies(context.request.headers.get("Cookie"));
  const sessionValue = cookies[COOKIE_NAME];

  if (url.pathname === "/__review-access" && context.request.method === "POST") {
    const formData = await context.request.formData();
    const submittedPasscode = String(formData.get("passcode") ?? "");
    const redirectTo = sanitizeRedirect(String(formData.get("redirect") ?? "/"));

    if (!safeEqual(submittedPasscode, passcode)) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const response = new Response(renderGatePage({ actionPath: "/__review-access", redirectTo, invalidPasscode: true }), {
        status: 401,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "private, no-store",
        },
      });
      response.headers.set("Content-Security-Policy", HTML_GATE_CSP);
      applySharedHeaders(response.headers);
      return response;
    }

    const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
    const payload = `${expiresAt}`;
    const signature = await signPayload(cookieSecret, payload);
    const response = new Response(null, {
      status: 303,
      headers: {
        location: redirectTo,
        "cache-control": "private, no-store",
      },
    });
    response.headers.append(
      "set-cookie",
      `${COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`,
    );
    applySharedHeaders(response.headers);
    return response;
  }

  if (url.pathname === "/__review-logout") {
    const response = new Response(null, {
      status: 303,
      headers: {
        location: "/",
        "cache-control": "private, no-store",
      },
    });
    response.headers.append("set-cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    applySharedHeaders(response.headers);
    return response;
  }

  if (sessionValue) {
    const [payload, signature] = sessionValue.split(".");
    if (payload && signature) {
      const expected = await signPayload(cookieSecret, payload);
      const expiresAt = Number(payload);
      if (safeEqual(expected, signature) && Number.isFinite(expiresAt) && expiresAt > Date.now()) {
        const response = await context.next();
        applySharedHeaders(response.headers);
        return response;
      }
    }
  }

  if (isAssetPath(url.pathname)) {
    const response = new Response("Review access required", {
      status: 401,
      headers: {
        "cache-control": "private, no-store",
      },
    });
    applySharedHeaders(response.headers);
    return response;
  }

  const response = new Response(renderGatePage({ actionPath: "/__review-access", redirectTo: `${url.pathname}${url.search}`, invalidPasscode: false }), {
    status: 401,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
  response.headers.set("Content-Security-Policy", HTML_GATE_CSP);
  applySharedHeaders(response.headers);
  return response;
}

export const reviewGateInternals = {
  COOKIE_NAME,
  HTML_GATE_CSP,
  SESSION_TTL_SECONDS,
  applySharedHeaders,
  isAssetPath,
  isLocalHost,
  parseCookies,
  renderGatePage,
  sanitizeRedirect,
  safeEqual,
  signPayload,
};
