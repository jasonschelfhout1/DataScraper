import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from './api';
import type { ArchiveSearchOptions } from './api';
import { filterDocuments, formatSize } from './filter';
import type { ArchiveDocument, ArchiveFilters, ArchiveProject, ArchiveStats } from './types';

interface ScraperAppProps { username: string; onLogout: () => Promise<void> }

const pageSize = 15;

export default function ScraperApp({ username, onLogout }: ScraperAppProps) {
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<ArchiveProject[]>([]);
  const [resultTotal, setResultTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<ArchiveProject>();
  const [documents, setDocuments] = useState<ArchiveDocument[]>([]);
  const [documentQuery, setDocumentQuery] = useState('');
  const [documentCategory, setDocumentCategory] = useState('All');
  const [stats, setStats] = useState<ArchiveStats>();
  const [availableFilters, setAvailableFilters] = useState<ArchiveFilters>({ municipalities: [], statuses: [], publicationTypes: [] });
  const [filters, setFilters] = useState<ArchiveSearchOptions>({ municipality: '', status: '', publicationType: '', visibility: 'all' });
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string>();

  const documentCategories = ['All', ...Array.from(new Set(documents.map((document) => document.category ?? 'Other'))).sort((left, right) => left.localeCompare(right))];
  const visibleDocuments = filterDocuments(documents, documentQuery, documentCategory);
  const zipDocuments = selected?.source === 'live' ? documents.filter(isPublicDownload) : documents.filter(isBucketDownload);
  const filteredZipDocuments = selected?.source === 'live' ? visibleDocuments.filter(isPublicDownload) : visibleDocuments.filter(isBucketDownload);
  const totalPages = Math.max(1, Math.ceil(resultTotal / pageSize));
  const resultStart = resultTotal === 0 ? 0 : page * pageSize + 1;
  const resultEnd = Math.min((page + 1) * pageSize, resultTotal);

  useEffect(() => {
    void Promise.all([api.archiveStatus(), api.archiveFilters()])
      .then(([archiveStats, archiveFilters]) => { setStats(archiveStats); setAvailableFilters(archiveFilters); })
      .catch(() => undefined);
  }, []);

  async function runSearch(nextPage: number, clearDetail: boolean): Promise<void> {
    setSearching(true); setError(undefined); setHasSearched(true);
    if (clearDetail) { setSelected(undefined); setDocuments([]); }
    try {
      const result = await api.searchArchive(query, filters, nextPage, pageSize);
      if (result.total === 0 && nextPage === 0 && hasNoProjectFilters(filters) && canUseLiveFallback(query)) {
        try { const project = await api.liveProject(query); setProjects([project]); setResultTotal(1); setPage(0); }
        catch (liveError) { if (!(liveError instanceof ApiError && liveError.code === 'NOT_FOUND')) throw liveError; setProjects([]); setResultTotal(0); setPage(0); }
      } else { setProjects(result.projects); setResultTotal(result.total); setPage(nextPage); }
    } catch (cause) { setError(message(cause)); } finally { setSearching(false); }
  }

  function search(event: FormEvent): void { event.preventDefault(); void runSearch(0, true); }

  async function open(project: ArchiveProject): Promise<void> {
    setSelected(project); setOpening(true); setError(undefined); setDocumentQuery(''); setDocumentCategory('All');
    try { setDocuments(project.source === 'live' ? await api.liveDocuments(project.projectNumber) : await api.archiveDocuments(project.projectNumber)); } catch (cause) { setError(message(cause)); } finally { setOpening(false); }
  }

  function setFilter<Key extends keyof ArchiveSearchOptions>(key: Key, value: ArchiveSearchOptions[Key]): void { setFilters((current) => ({ ...current, [key]: value })); }

  return <main className="shell compact-shell">
    <header className="app-header compact-header"><div><p className="eyebrow">PRIVATE ARCHIVE</p><div className="title-row"><h1>Omgevingsloket Archive</h1><a className="button-link global-download" href="/api/archive/download">Download all files{stats ? ` (${stats.archivedDocuments.toLocaleString()})` : ''}</a></div></div><div className="header-actions">{stats && <span className="archive-summary">{stats.projects.toLocaleString()} projects / {stats.archivedDocuments.toLocaleString()} files</span>}<button className="secondary logout" type="button" onClick={() => void onLogout()}>Log out {username}</button></div></header>
    {stats?.paused && <p className="notice">Crawler paused: {stats.pauseReason ?? 'authorization required'}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="workspace">
      <aside className="result-pane">
        <form className="search compact-search" onSubmit={search}>
          <label htmlFor="archive-search">Search archive</label>
          <div className="search-controls"><input id="archive-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, municipality or number" /><button disabled={searching}>{searching ? 'Searching...' : 'Search'}</button></div>
          <fieldset className="search-filters"><legend>Filter results</legend>
            <label>Municipality<select value={filters.municipality} onChange={(event) => setFilter('municipality', event.target.value)}><option value="">All municipalities</option>{availableFilters.municipalities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Publication type<select value={filters.publicationType} onChange={(event) => setFilter('publicationType', event.target.value)}><option value="">All publication types</option>{availableFilters.publicationTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Status<select value={filters.status} onChange={(event) => setFilter('status', event.target.value)}><option value="">All statuses</option>{availableFilters.statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Availability<select value={filters.visibility} onChange={(event) => setFilter('visibility', event.target.value as ArchiveSearchOptions['visibility'])}><option value="all">All archived projects</option><option value="current">Currently public</option><option value="historical">No longer public</option></select></label>
          </fieldset>
        </form>
        {hasSearched && <section className="results-list" aria-label="Archive results"><div className="result-heading"><strong>{resultTotal.toLocaleString()} results</strong>{resultTotal > 0 && <span>{resultStart}-{resultEnd}</span>}</div>{projects.length === 0 ? <p className="notice">No matching projects.</p> : projects.map((project) => <button type="button" className={`archive-result ${selected?.id === project.id ? 'selected-result' : ''}`} key={project.id} onClick={() => void open(project)} disabled={opening}><strong>{project.projectNumber}</strong><span>{project.title ?? 'Untitled project'}</span><small>{project.source === 'live' ? 'Live Omgevingsloket result' : `${project.municipality ?? 'Municipality unavailable'} - ${project.documentCount ?? 0} files`}</small></button>)}{resultTotal > pageSize && <nav className="pagination" aria-label="Result pages"><button className="secondary" type="button" disabled={searching || page === 0} onClick={() => void runSearch(page - 1, false)}>Previous</button><span>Page {page + 1} / {totalPages}</span><button type="button" disabled={searching || page + 1 >= totalPages} onClick={() => void runSearch(page + 1, false)}>Next</button></nav>}</section>}
      </aside>
      <section className="detail-pane" aria-live="polite">{!selected ? <div className="empty-detail"><h2>Select a project</h2><p>Search and choose a result to view its documents here.</p></div> : <>
        <div className="detail-heading"><div><p className="eyebrow">{selected.source === 'live' ? 'LIVE FALLBACK' : 'ARCHIVED PROJECT'}</p><h2>{selected.title ?? `Project ${selected.projectNumber}`}</h2><p>{selected.projectNumber} - {selected.source === 'live' ? 'Not stored in the local archive.' : selected.isCurrentlyPublic ? 'Currently observed as public.' : 'No longer observed as public.'}</p></div></div>
        {opening ? <p className="notice">Loading documents...</p> : documents.length === 0 ? <p className="notice">No documents are available for this project.</p> : <>
          <div className="document-controls"><label>Find document<input value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)} placeholder="File name or description" /></label><label>Category<select value={documentCategory} onChange={(event) => setDocumentCategory(event.target.value)}>{documentCategories.map((category) => <option key={category}>{category}</option>)}</select></label><div className="download-actions">{zipDocuments.length > 0 ? <a className="button-link" href={projectDownloadUrl(selected)}>Download all {selected.source === 'live' ? 'public' : 'archived'} ({zipDocuments.length})</a> : <button type="button" disabled>Download all archived (0)</button>}{filteredZipDocuments.length > 0 ? <a className="button-link secondary-link" href={projectDownloadUrl(selected, filteredZipDocuments)}>Download filtered ({filteredZipDocuments.length})</a> : <span>{selected.source === 'live' ? 'No matching public files' : 'No matching bucket files'}</span>}</div></div>
          <div className="table-wrap detail-table"><table><thead><tr><th>Name</th><th>Category</th><th>Type</th><th>Size</th><th>Status</th><th>Action</th></tr></thead><tbody>{visibleDocuments.map((document) => <tr key={document.id}><td>{document.filename}</td><td>{document.category ?? 'Other'}</td><td>{document.mimeType ?? '-'}</td><td>{formatSize(document.sizeBytes)}</td><td>{document.downloadStatus}</td><td>{document.downloadable ? <a href={documentDownloadUrl(document)}>{document.source === 'live' || document.downloadStatus === 'downloaded' ? 'Download' : 'Try live source'}</a> : document.viewerUrl ? <a href={document.viewerUrl} target="_blank" rel="noreferrer">View at source</a> : <span>View only</span>}</td></tr>)}</tbody></table></div>{visibleDocuments.length === 0 && <p className="notice">No documents match this filter.</p>}
        </>}
      </>}</section>
    </div>
  </main>;
}

function isPublicDownload(document: ArchiveDocument): boolean { return document.downloadable; }
function isBucketDownload(document: ArchiveDocument): boolean { return document.downloadable && document.downloadStatus === 'downloaded' && Boolean(document.storageKey); }
function projectDownloadUrl(project: ArchiveProject, documents?: ArchiveDocument[]): string { const parameters = new URLSearchParams(); documents?.forEach((document) => parameters.append('documentId', document.id)); const suffix = parameters.size ? `?${parameters}` : ''; return `/api/${project.source === 'live' ? 'live' : 'archive'}/projects/${encodeURIComponent(project.projectNumber)}/download${suffix}`; }
function documentDownloadUrl(document: ArchiveDocument): string { return document.source === 'live' ? `/api/live/documents/${document.id}/download?projectNumber=${encodeURIComponent(document.projectNumber)}` : `/api/archive/documents/${document.id}/download`; }
function hasNoProjectFilters(filters: ArchiveSearchOptions): boolean { return !filters.municipality && !filters.status && !filters.publicationType && filters.visibility === 'all'; }
function canUseLiveFallback(input: string): boolean { return /^(?:omv_)?\d{10}$/i.test(input.trim()) || /^https:\/\//i.test(input.trim()); }
function message(error: unknown): string { if (error instanceof ApiError && error.code === 'NOT_FOUND') return 'This project is not available in the archive or on the official site.'; if (error instanceof ApiError && error.code === 'VERIFICATION_REQUIRED') return 'Official browser verification is required before live fallback can be used. Run npm run authorize and update the web service session.'; return error instanceof Error ? error.message : 'The archive could not be queried.'; }
