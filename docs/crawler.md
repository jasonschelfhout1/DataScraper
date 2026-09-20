# Crawler

`crawl:once` runs a bounded, restart-safe batch. PostgreSQL leases work with `FOR UPDATE SKIP LOCKED`; expired leases are returned to pending work before a new batch claims tasks.

```text
PENDING
  ↓ claim / lease
RUNNING
  ├─ success ───────────────→ COMPLETED
  ├─ transient failure ─────→ PENDING (next_attempt_at)
  ├─ attempts exhausted ───→ FAILED
  └─ verification required → PENDING + crawler_state.paused
```

The crawler runs at concurrency one with a configurable global minimum delay and jitter. An upstream verification response pauses the crawler without deleting its backlog; renew the authorized session manually, clear the pause after validating it, then resume with the next batch.

`discover_projects` is intentionally fail-closed until `npm run discover -- search --har` captures a confirmed official enumeration endpoint. Use `npm run crawl:project -- <projectNumber>` for a bounded known-project crawl in the meantime.
