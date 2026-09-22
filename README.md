# Omgevingsloket Archive

An authenticated, archive-first utility for documents that the Flemish Omgevingsloket Inzageloket has made publicly downloadable. Normal users search PostgreSQL-backed archive data; browser requests never cause live Omgevingsloket traffic.

The archive grows as the crawler observes currently public projects. It cannot guarantee recovery of historical projects that disappeared before the crawler saw them. Copyright/view-only files are stored only as metadata; no viewer rendering, watermark removal, or download restriction bypass is attempted.

## Architecture

- PostgreSQL holds project/document metadata, provenance, archive status, crawler queue, leases, and pause state.
- Private Cloudflare R2 holds only legitimately downloadable (`PUBLIEK_DOWNLOAD`) binaries.
- The crawler is the sole live Omgevingsloket client. It is slow, concurrency-one, resumable, and pauses if manual visitor verification expires.
- Express serves authenticated archive APIs and generates short-lived R2 download links. React never receives R2 write credentials or the Omgevingsloket session cookie.

See [archive architecture](docs/archive-architecture.md), [crawler](docs/crawler.md), [storage](docs/storage.md), and [confirmed upstream API evidence](docs/omgevingsloket-api.md).

## Local setup

Requires Node.js 22–25, Docker (optional PostgreSQL convenience), and a private R2 bucket.

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
npm ci
npm run db:migrate
```

Set in `.env`: `DATABASE_URL`, `AUTH_USERNAME`, `AUTH_PASSWORD`, `AUTH_SESSION_SECRET`, and the R2 variables. Generate the session secret with `openssl rand -base64 48`. `.env` must never be committed.

Run the web app with `npm run dev`. It displays a login screen, then searches the local archive. `GET /api/health` remains public; archive APIs require the signed HTTP-only session cookie. Login attempts and authenticated API use remain rate-limited.

## Crawler and discovery

```powershell
# Manual, visible official verification only
npm run authorize -- 2026045710

# Confirm a known project traversal
npm run discover -- project 2026045710 --har

# Capture the public map/search contract (already completed for this repository)
npm run discover -- search --har

# Required before Inhoud aanvraag files can be archived
npm run discover -- content 2026045710 --har

# Known-project archive crawl; normal users cannot trigger it
npm run crawl:project -- 2026045710
npm run crawl:once

# Queue a captured EPSG:31370 map viewport for paginated archive discovery.
# Use only bounds you intentionally want the crawler to cover.
npm run crawl:discover -- 99138 181025 129337 203330
npm run crawl:once
npm run crawl:status
# After a fresh manual authorization if crawler status says paused
npm run crawl:resume
```

`discover -- search` requires you to manually search a municipality, paginate, adjust publication/authority filters, and pan/zoom the map. `discover -- content` requires manually opening the content branches and a legitimately downloadable file. Sanitized evidence is written under ignored `debug/discovery/`; do not guess routes from UI labels.

The captured search endpoint supports bounded, paginated map discovery. It is intentionally not treated as a nationwide endpoint: choose and queue explicit EPSG:31370 map bounds, then let the conservative worker process them. The known event traversal is confirmed; the `Inhoud aanvraag` nested file relationship is still only partially confirmed.

## Low-cost deployment

This Blueprint is intentionally capped for a personal archive target of under €10/month. It cannot create an unconditional vendor billing guarantee: pricing, external usage in a shared account, and user changes to limits are outside the application. Keep the R2 bucket dedicated to this app and do not raise `ARCHIVE_MAX_STORAGE_BYTES`.

Create a **private, Standard-class** Cloudflare R2 bucket, preferably in an EU jurisdiction, and create an S3 API token limited to that bucket. Configure `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, and `R2_REGION=auto`. The bucket is never public. The crawler refuses additional uploads after 8 GiB, which stays below R2's 10 GB monthly Standard-storage free allowance.

Create a free Supabase Postgres project and use its SSL connection string as `DATABASE_URL`. Its free plan has a 500 MB database limit; if that fills, it becomes read-only rather than creating an overage. The archive's PDF bytes remain in R2, not the database.

The Render Blueprint defines a free web service and a once-daily, bounded starter Cron Job. Configure these secrets on **both** services as applicable:

```text
AUTH_USERNAME
AUTH_PASSWORD
AUTH_SESSION_SECRET
OMGEVINGSLOKET_COOKIE_HEADER
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_BUCKET
R2_ENDPOINT
DATABASE_URL
```

Run `npm run db:migrate` once against the external `DATABASE_URL` before enabling the crawler. The cron uses `npm run crawl:once`; use `npm run crawl:worker` only for a deliberate future Background Worker deployment, never alongside the cron without operational review.

To retain an existing local archive when moving to Supabase, run the migration above, then set `SOURCE_DATABASE_URL` to the local PostgreSQL URL and run `npm run db:import-local`. The importer refuses to run unless all destination archive tables are empty, copies metadata and queue state in dependency order, and verifies each row count. It never copies or deletes R2 objects.

`datascraper-db-prune` runs every Sunday at 03:30 UTC. It removes only completed crawl tasks older than seven days and runs `VACUUM (ANALYZE)` on that queue table. Run `npm run db:prune` locally to perform the same safe maintenance. It never deletes archive metadata or R2 objects. The separate maintenance Cron Job has Render's $1/month minimum, which is included in the stated personal budget.

The intended baseline is: Render web $0, Supabase Postgres $0 while it remains within 500 MB, Render Cron Job about $1/month minimum, and R2 $0 while it remains within its free tier. Check both provider dashboards after deployment; do not add unrelated data to the R2 bucket or enable paid database/storage upgrades.

## Safety and troubleshooting

The crawler keeps durable task state in PostgreSQL. It uses leases and `SKIP LOCKED` claiming so an interrupted batch resumes safely. A verification failure pauses crawler traffic while retaining pending tasks; complete the official verification manually, update the secret/session, and resume later.

The provider uses only confirmed official HTTPS endpoints, strict host validation, typed response parsing, and no brute force project-number enumeration. It does not access personal/citizen areas. See the upstream record for confirmed, partially confirmed, and unknown routes.

## Validation

```powershell
npm test
npm run build
# Manual live check only after authorization:
npm run test:integration -- 2026045710
```
