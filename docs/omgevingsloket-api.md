# Omgevingsloket API discovery

## Confirmed capture

On 20 September 2026, a user-authorized visible-browser capture of project `2018110330` confirmed the same-origin API below. The capture contained an Anubis visitor-verification cookie; it is neither documented here nor committed. The application uses the locally authorized session only while valid and never attempts to solve the verification.

All confirmed calls are under:

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
| Public map viewport → projects | `POST /projecten/zoeken?page={n}&size=10&sort=PROJECTNUMMER` | Spring page (`content`, `number`, `totalPages`, `last`) using an EPSG:31370 `BOUNDING_BOX` filter |
| Project → contents branch | `/projecten/{projectUuid}/inhouden` | `uuid`, `puuid`, version and status metadata only |

## Confirmed behavior

- The observed dossier has project UUID `78Jiio5hTkScAWF-m1ikZg`, phase UUID `CVVCIlCqTAq_cfYodAu6fA`, and event UUID `1CRvyT15SQaSnTSl_kCaIw`.
- Its event detail contained 13 PDF files marked `veiligheidscategorie: PUBLIEK_DOWNLOAD`.
- Confirmed download responses were `200 application/pdf` with a normal attachment filename. The provider exposes only files with that category as downloadable; other files remain view-only.
- Paged event collections use `content` and `totalPages`. The provider requests all pages at size 100 while retaining the configured upstream concurrency cap.
- `openbare-onderzoeken` can group its actual event summaries under each result's `gebeurtenis[]` array rather than return event summaries directly.
- Advice summaries can identify the detail resource as `adviesVraagGebeurtenisUuid`; that value is accepted by the same `/gebeurtenissen/{id}` detail endpoint.
- The authorized map capture used a `POST` body containing one `BOUNDING_BOX` filter with `@type: InzageFilterinhoudMetBoundingBox` and `coordinatenStelsel: EPSG:31370`. Results expose public UUIDs, project number, name, authority, address, and publication type. The implementation retains the observed page size of 10.

## Scope and limitations

The implemented provider follows every procedure phase and all four captured event collections. It also supports bounded map discovery through the captured search contract: run `npm run crawl:discover -- <minX> <minY> <maxX> <maxY>` and then run the worker. It deliberately does not infer a geographic coverage area or fabricate wider bounds.

The capture also showed a project `inhouden` endpoint, but did not include a nested content-to-file request; it is intentionally not guessed or traversed. A later authorized capture of a file opened from that UI branch is required before adding it.

## Archive crawler status

| Capability | Status | Notes |
| --- | --- | --- |
| Known-project header/overview/procedure/event traversal | **CONFIRMED** | Used only by the crawler, never normal archive browsing. |
| Event file metadata and `PUBLIEK_DOWNLOAD` binary download | **CONFIRMED** | Only this explicit category is eligible for archival. |
| Start-page map project enumeration inside an explicit viewport | **CONFIRMED** | `POST /projecten/zoeken` with the captured EPSG:31370 bounding-box filter; pages are processed at the observed size of 10. |
| `Inhoud aanvraag` nested content/file relationships | **PARTIALLY CONFIRMED** | Parent contents metadata was observed, but no file relationship was captured. Run `npm run discover -- content <project> --har` and open a file in that branch. |

If the session expires or the service changes, re-run `npm run authorize -- <project>` and `npm run discover -- <project> --har`, then compare the new capture with these documented contracts.
