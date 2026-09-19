# Omgevingsloket API discovery

## Current status

No application endpoint is recorded yet. On 20 September 2026, direct HTTP access to the supplied project URL returned the official Anubis browser-verification page, not the application shell. This repository intentionally does not infer, probe, or manufacture API routes from that response.

## Required discovery procedure

1. Install Playwright's Chromium once if necessary: `npx playwright install chromium`.
2. Run `npm run discover -- 2026045710 --har`.
3. In the visible browser, complete the official verification and open the project summary, each visible content/phase section, a document viewer, and one ordinary downloadable document where available.
4. Return to the terminal and press Enter. Evidence is stored under gitignored `debug/discovery/`.
5. Record only verified endpoints below, then implement the HTTP provider. Never copy cookies or authorization values into this document.

## Confirmed request hierarchy

Pending a user-verified network capture.

| Relationship | Endpoint/method | Required identifiers | Evidence |
| --- | --- | --- | --- |
| Project number to project | Pending | Pending | Pending |
| Project to visible contents | Pending | Pending | Pending |
| Content to documents | Pending | Pending | Pending |
| Document viewer | Pending | Pending | Pending |
| Document download | Pending | Pending | Pending |

## Provider implementation rule

The provider must map external objects into `Project` and `Document`, produce a browser-safe opaque document ID, and allow only exact hosts observed in the capture. It must classify downloadable versus view-only files from the public site’s actual behavior. No API contract is confirmed until it is linked to a capture artifact.
