# Omgevingsloket Document Downloader

A local, small-scale utility for listing and downloading documents that the Flemish Omgevingsloket Inzageloket publicly makes available. It is not a general web proxy and it never bypasses access restrictions, authentication, CAPTCHA, anti-bot verification, disabled downloads, watermarks, or viewer-only decisions.

## Status and upstream discovery

The HTTP provider is based only on a user-authorized network capture of the public Inzageloket. It follows project → phase → event → file relationships, identifies files marked `PUBLIEK_DOWNLOAD`, and downloads only those files. See [the confirmed API record](docs/omgevingsloket-api.md).

## Install and run

Requires Node.js 22+ and npm. From the repository root:

```powershell
npm install
npx playwright install chromium
Copy-Item .env.example .env
npm run dev
```

Open `http://localhost:5173`. The Vite development server proxies `/api` to Express at port 3001. For production, run `npm run build` followed by `npm start`; Express serves the built frontend and API.

## Authorize and discover

The local browser session is an explicit, normal visitor session. It is not shared, committed, or used to solve the verification automatically.

```powershell
# Opens a visible browser. Complete the official check, then press Enter in this terminal.
npm run authorize -- 2026045710

# Captures the real project/document traffic while you navigate the official UI.
npm run discover -- 2026045710 --har
```

`discover` accepts either a 10-digit number, its optional `OMV_` prefix, or an exact `https://omgevingsloketinzage.omgeving.vlaanderen.be/<number>` URL. It records sanitized JSON metadata and, when requested, a sanitized HAR with response bodies omitted below `debug/discovery/`. Do not commit those artifacts. The session cookie file is stored mode-restricted under `.local/` and must be renewed when it expires.

The confirmed provider is isolated in `backend/src/omgevingsloket/`. If Vlaanderen changes the external API, re-run discovery, update the API record, and change only this integration layer.

## Architecture

- `frontend/`: React, TypeScript, Vite, native `fetch`, and responsive CSS. The browser knows only the local `/api` contract.
- `backend/`: Express API, input/SSRF validation, metadata cache, allowlisted HTTP client, local session store, structured logging, and ZIP download jobs with Server-Sent Event progress.
- `scripts/`: headed Playwright discovery and official-session authorization. Playwright is not the normal download mechanism.

The intended internal API is `GET /api/projects/:projectNumber`, `GET /api/projects/:projectNumber/documents`, an individual document download route, and bulk ZIP jobs (`POST /api/projects/:projectNumber/downloads`, status/events/file routes). Document IDs are opaque and a download is always rechecked against the server-side document listing.

## Security and rate limits

Only the configured exact official HTTPS hostname is permitted. User input is normalized to a project number; it is never treated as a target URL. The HTTP client has a 15-second timeout, a maximum of three concurrent upstream calls, bounded retries for transient failures, and no binary-file cache. Adjust the documented settings in `.env` only when appropriate for the public service.

Set `DEBUG_OMGEVINGSLOKET=true` when implementing a confirmed provider to log safe request metadata; do not log cookies, authorization values, or binary bodies.

## Validation

```powershell
npm test
# Manual only; uses your currently authorized session:
npm run test:integration -- 2026045710
```

Unit/API tests make no live government requests. They cover input and SSRF validation, safe/duplicate filenames, cache expiry, filtering, the no-proxy boundary, and safe individual downloads.
