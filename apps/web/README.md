# Web App

Internal dashboard and public customer upload flow for Curve AI.

## Local run

1. Install dependencies from `apps/web`:

```bash
npm install
```

2. Optional: set the API base URL directly:

```bash
export VITE_API_BASE_URL="http://localhost:3000"
```

If you leave `VITE_API_BASE_URL` unset, the Vite dev server proxies `/api/*` to `http://localhost:3000` by default.

3. Start the app:

```bash
npm run dev
```

4. Build for production:

```bash
npm run build
```

5. Run the web tests:

```bash
npm run test
```

## Expected API base URL

The app expects a JSON API at `VITE_API_BASE_URL` or `/api` if the variable is not set.

## Admin token

The internal dashboard requires an admin token before it will request live data. The token is stored in
`localStorage` under `curve-ai.admin-token` after you enter it in the UI.

## Routes

- `/` internal dashboard
- `/upload/:token` public photo upload page
