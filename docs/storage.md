# Private object storage

R2 is private. Object keys are deterministic and collision-safe:

```text
projects/{projectNumber}/{upstreamDocumentUuid}/{sanitizedFilename}
```

The crawler streams upstream bytes through a SHA-256 calculation into S3-compatible R2 multipart upload. It records the key, byte count, hash, content type, and timestamp only after upload success. Failed uploads leave documents retryable.

The web service never exposes R2 credentials or permanent URLs. An authenticated download request checks PostgreSQL state and redirects to a 60-second signed GET URL. Use an EU-jurisdiction R2 bucket where appropriate for your deployment and retention requirements.
