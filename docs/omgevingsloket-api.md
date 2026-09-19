# Omgevingsloket API discovery

## Confirmed capture

On 20 September 2026, a user-authorized visible-browser capture of project `2018110330` confirmed the same-origin API below. The capture contained an Anubis visitor-verification cookie; it is neither documented here nor committed. The application uses the locally authorized session only while valid and never attempts to solve the verification.

All confirmed calls are `GET` under:

```text
https://omgevingsloketinzage.omgeving.vlaanderen.be/proxy-omv-up/rs/v1/inzage
```

| Relationship | Confirmed endpoint | Key response fields |
| --- | --- | --- |
| Project number → project | `/projecten/header?projectnummer={number}` | `uuid`, `projectnummer`, `projectnaam`, `toestand` |
| Project → overview | `/projecten/{projectUuid}/project-overzicht` | `bevoegdeOverheid`, decision summary |
| Project → phases | `/projecten/{projectUuid}/procedure` | phase `uuid` |
| Phase → events | `/projectfasen/{phaseUuid}/openbare-onderzoeken` and `.../{advies,beslissing,andere}-gebeurtenissen?page={n}&size=100&sort=id` | event `uuid`, event code |
| Event → files | `/gebeurtenissen/{eventUuid}` | `bestanden[]` with `uuid`, `bestandsnaam`, `omschrijving`, `mimeType`, `grootte`, `veiligheidscategorie` |
| Public file → download | `/bestanden/{fileUuid}/download` | PDF response, `Content-Disposition`, `Content-Length` |

## Confirmed behavior

- The observed dossier has project UUID `78Jiio5hTkScAWF-m1ikZg`, phase UUID `CVVCIlCqTAq_cfYodAu6fA`, and event UUID `1CRvyT15SQaSnTSl_kCaIw`.
- Its event detail contained 13 PDF files marked `veiligheidscategorie: PUBLIEK_DOWNLOAD`.
- Confirmed download responses were `200 application/pdf` with a normal attachment filename. The provider exposes only files with that category as downloadable; other files remain view-only.
- Paged event collections use `content` and `totalPages`. The provider requests all pages at size 100 while retaining the configured upstream concurrency cap.
- `openbare-onderzoeken` can group its actual event summaries under each result's `gebeurtenis[]` array rather than return event summaries directly.
- Advice summaries can identify the detail resource as `adviesVraagGebeurtenisUuid`; that value is accepted by the same `/gebeurtenissen/{id}` detail endpoint.

## Scope and limitations

The implemented provider follows every procedure phase and all four captured event collections. The capture also showed a project `inhouden` endpoint, but did not include a nested content-to-file request; it is intentionally not guessed or traversed. A later authorized capture of that UI branch is required before adding it.

If the session expires or the service changes, re-run `npm run authorize -- <project>` and `npm run discover -- <project> --har`, then compare the new capture with these documented contracts.
