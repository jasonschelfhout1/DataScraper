# Omgevingsloket Document Downloader

A small service for listing and downloading documents that the Flemish Omgevingsloket Inzageloket publicly makes available. It is not a general web proxy and never bypasses access restrictions, authentication, CAPTCHA, anti-bot verification, disabled downloads, watermarks, or viewer-only decisions.

## Status and upstream discovery

The HTTP provider is based only on a user-authorized network capture of the public Inzageloket. It follows project → phase → event → file relationships, identifies files marked `PUBLIEK_DOWNLOAD`, and downloads only those files. See [the confirmed API record](docs/omgevingsloket-api.md).

## Install and run locally

Requires Node.js 22–25 and npm. From the repository root:

```powershell
npm install
npx playwright install chromium
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to Express at port 3001. For a local production check, run `npm run build` followed by `npm start`; Express serves the built frontend and API.

## Authentication

This is intentionally a single-user/shared-credential utility. Before running it locally, create `.env` from `.env.example` and set `AUTH_USERNAME`, `AUTH_PASSWORD`, and `AUTH_SESSION_SECRET`. Generate the session secret with:

```bash
openssl rand -base64 48
```

The application stores only a signed, HTTP-only session cookie for about 24 hours; it never places the password, application secrets, or the Omgevingsloket cookie in the React bundle or browser storage. The login endpoint has a separate five-attempts-per-15-minutes IP limit. Existing project request limits remain active after login. `GET /api/health` stays public for Render, while scraper and download APIs require a valid session.

Never commit `.env`. On Render, configure `AUTH_USERNAME`, `AUTH_PASSWORD`, and `AUTH_SESSION_SECRET` as secrets along with `OMGEVINGSLOKET_COOKIE_HEADER`.

## Deploy on Render

This repository is ready for one Render Web Service. Commit [render.yaml](render.yaml), push to GitHub, then create a **Blueprint** in Render and select the repository. The Blueprint builds with `npm ci && npm run build`, starts with `npm start`, and checks `GET /api/health`; Render supplies `PORT` automatically.

Set `OMGEVINGSLOKET_COOKIE_HEADER` as a Render **secret** (it is deliberately marked `sync: false` in the Blueprint). Its value is the complete, currently verified `Cookie` request-header value from your own authorized browser session, for example `name=value; other=value`. Do not paste it into the repository, GitHub Actions logs, issues, or browser/client settings. It takes precedence over the local `.local/omgevingsloket-session.json` file.

Rotate this secret by re-running `npm run authorize` locally, completing the official browser verification yourself, obtaining a current cookie-header value, updating the Render secret, and redeploying. If it expires or is rejected, the service returns an actionable upstream error and does not attempt to defeat verification.

The service uses `/tmp/datascraper` on Render for temporary ZIP archives. Render's filesystem is ephemeral, so archives and any local browser session disappear on restart. Run a single service instance: ZIP job state and the conservative request limiter are intentionally in-memory.

## Authorize and discover

The local browser session is an explicit, normal visitor session. It is not shared, committed, or used to solve verification automatically.

```powershell
# Opens a visible browser. Complete the official check, then press Enter here.
npm run authorize -- 2026045710

# Captures real project/document traffic while you navigate the official UI.
npm run discover -- 2026045710 --har
```

`discover` accepts a 10-digit number, its optional `OMV_` prefix, or an exact `https://omgevingsloketinzage.omgeving.vlaanderen.be/<number>` URL. It records sanitized JSON metadata and, when requested, a sanitized HAR with response bodies omitted below `debug/discovery/`. Do not commit those artifacts. The local session cookie file is mode-restricted under `.local/` and must be renewed when it expires.

The confirmed provider is isolated in `backend/src/omgevingsloket/`. If Vlaanderen changes the external API, re-run discovery, update the API record, and change only this integration layer. In deployed environments, update the secret only after a user completes the official verification; never automate or bypass it.

## Architecture and safety

- `frontend/`: React, TypeScript, Vite, native `fetch`, and responsive CSS. The browser knows only the local `/api` contract.
- `backend/`: Express API, input/SSRF validation, metadata cache, allowlisted HTTP client, local session store, structured logging, and ZIP download jobs with Server-Sent Event progress.
- `scripts/`: headed Playwright discovery and official-session authorization. Playwright is not the normal download mechanism.

The internal API is `GET /api/projects/:projectNumber`, `GET /api/projects/:projectNumber/documents`, an individual document download route, and bulk ZIP jobs (`POST /api/projects/:projectNumber/downloads`, status/events/file routes). Document IDs are opaque and downloads are always rechecked against the server-side listing.

Only the configured exact official HTTPS hostname is permitted. User input is normalized to a project number; it is never treated as a target URL. The HTTP client has a timeout, conservative concurrency, bounded transient retries, and no binary-file cache.

Set `DEBUG_OMGEVINGSLOKET=true` only when investigating a confirmed provider to log safe request metadata. Cookies, authorization values, request headers, and binary bodies are not logged. Request logs deliberately contain only method, path, remote address, and status.

`MAX_ACTIVE_DOWNLOAD_JOBS`, `MAX_DOCUMENTS_PER_DOWNLOAD`, and the `EXPENSIVE_REQUEST_*` variables protect the public service from expensive work. `LOCAL_DATA_DIR` defaults to `.local` locally and should be `/tmp/datascraper` on Render. Invalid configuration fails closed at startup without including a secret value in the error.

## Validation and troubleshooting

```powershell
npm test
# Manual only; uses your currently authorized session:
npm run test:integration -- 2026045710
```

Tests make no live government requests. They cover input and host validation, safe/duplicate filenames, cache expiry, filtering, cookie source precedence, no-proxy boundaries, download headers, ZIP job behavior, and the health endpoint.

If upstream retrieval breaks, first verify the authorized session in a visible browser, then run `discover` again and compare the sanitized evidence with [the confirmed API record](docs/omgevingsloket-api.md). Do not guess at replacement endpoints or weaken host, cookie, or document-access checks.
