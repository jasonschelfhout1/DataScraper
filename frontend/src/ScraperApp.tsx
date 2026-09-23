import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from './api';
import type { ArchiveSearchOptions } from './api';
import { filterDocuments, formatSize } from './filter';
import type { ArchiveDocument, ArchiveFilters, ArchiveProject, ArchiveStats } from './types';

interface ScraperAppProps { username: string; onLogout: () => Promise<void> }

export default function ScraperApp({ username, onLogout }: ScraperAppProps) {
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<ArchiveProject[]>([]);
  const [resultTotal, setResultTotal] = useState(0);
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
  const downloadableDocuments = documents.filter(isPublicDownload);
  const filteredDownloadableDocuments = visibleDocuments.filter(isPublicDownload);

  useEffect(() => {
    void Promise.all([api.archiveStatus(), api.archiveFilters()])
      .then(([archiveStats, archiveFilters]) => { setStats(archiveStats); setAvailableFilters(archiveFilters); })
      .catch(() => undefined);
  }, []);

  async function search(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSearching(true); setError(undefined); setSelected(undefined); setDocuments([]); setHasSearched(true);
    try {
      const result = await api.searchArchive(query, filters);
      if (result.total === 0 && hasNoProjectFilters(filters) && canUseLiveFallback(query)) {
        try { const project = await api.liveProject(query); setProjects([project]); setResultTotal(1); }
        catch (liveError) { if (!(liveError instanceof ApiError && liveError.code === 'NOT_FOUND')) throw liveError; setProjects([]); setResultTotal(0); }
      } else { setProjects(result.projects); setResultTotal(result.total); }
    } catch (cause) { setError(message(cause)); } finally { setSearching(false); }
  }

  async function open(project: ArchiveProject): Promise<void> {
    setSelected(project); setOpening(true); setError(undefined); setDocumentQuery(''); setDocumentCategory('All');
    try { setDocuments(project.source === 'live' ? await api.liveDocuments(project.projectNumber) : await api.archiveDocuments(project.projectNumber)); } catch (cause) { setError(message(cause)); } finally { setOpening(false); }
  }

  function setFilter<Key extends keyof ArchiveSearchOptions>(key: Key, value: ArchiveSearchOptions[Key]): void {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  return <main className="shell">
    <header className="app-header"><div><p className="eyebrow">PRIVATE ARCHIVE</p><h1>Omgevingsloket Archive</h1><p>Historical copies of publicly downloadable Inzageloket documents observed by this archive. Source availability and copyright restrictions still apply.</p></div><button className="secondary logout" type="button" onClick={() => void onLogout()}>Log out {username}</button></header>
    {stats && <section className="project archive-status"><strong>{stats.projects.toLocaleString()} projects</strong><span>{stats.archivedDocuments.toLocaleString()} archived documents</span><span>{stats.viewOnlyDocuments.toLocaleString()} view-only metadata records</span><span>{stats.paused ? `Crawler paused: ${stats.pauseReason ?? 'authorization required'}` : `${stats.pendingTasks} tasks queued`}</span></section>}
    <form className="search" onSubmit={search}>
      <label htmlFor="archive-search">Search project number, municipality or project title</label>
      <div className="search-controls"><input id="archive-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Verbouwen woning, Antwerpen or 2026045710" /><button disabled={searching}>{searching ? 'Searching...' : 'Search archive'}</button></div>
      <fieldset className="search-filters"><legend>Filter results</legend>
        <label>Municipality<select value={filters.municipality} onChange={(event) => setFilter('municipality', event.target.value)}><option value="">All municipalities</option>{availableFilters.municipalities.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Publication type<select value={filters.publicationType} onChange={(event) => setFilter('publicationType', event.target.value)}><option value="">All publication types</option>{availableFilters.publicationTypes.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Status<select value={filters.status} onChange={(event) => setFilter('status', event.target.value)}><option value="">All statuses</option>{availableFilters.statuses.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Availability<select value={filters.visibility} onChange={(event) => setFilter('visibility', event.target.value as ArchiveSearchOptions['visibility'])}><option value="all">All archived projects</option><option value="current">Currently public</option><option value="historical">No longer public</option></select></label>
      </fieldset>
    </form>
    {error && <p className="notice error" role="alert">{error}</p>}
    {hasSearched && <section className="documents"><h2>Archive results <span className="result-count">{resultTotal.toLocaleString()}</span></h2>{projects.length === 0 ? <p className="notice">No archived projects match this search and these filters.</p> : projects.map((project) => <button type="button" className="archive-result" key={project.id} onClick={() => void open(project)} disabled={opening}><strong>{project.projectNumber}</strong><span>{project.title ?? 'Untitled project'}</span><span>{project.municipality ?? 'Municipality unavailable'}</span><small>{project.source === 'live' ? 'Live Omgevingsloket fallback' : `${project.publicationType ?? 'Publication type unavailable'} - Last seen ${new Date(project.lastSeenAt).toLocaleDateString()} - ${project.documentCount ?? 0} documents`}</small></button>)}</section>}
    {selected && <section className="documents"><h2>{selected.title ?? `Project ${selected.projectNumber}`}</h2><p>{selected.source === 'live' ? 'Live Omgevingsloket fallback. This project is not in the local archive.' : `${selected.isCurrentlyPublic ? 'Currently observed as public' : 'No longer observed as public'} - First seen ${new Date(selected.firstSeenAt).toLocaleDateString()} - Last synchronized ${selected.lastCrawledAt ? new Date(selected.lastCrawledAt).toLocaleString() : 'not yet crawled'}`}</p>{opening ? <p className="notice">Loading documents from {selected.source === 'live' ? 'the official site' : 'the archive'}...</p> : documents.length === 0 ? <p className="notice">No documents are available for this project.</p> : <>
      <div className="document-controls"><label>Find document<input value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)} placeholder="File name or description" /></label><label>Category<select value={documentCategory} onChange={(event) => setDocumentCategory(event.target.value)}>{documentCategories.map((category) => <option key={category}>{category}</option>)}</select></label><div className="download-actions">{downloadableDocuments.length > 0 ? <a className="button-link" href={projectDownloadUrl(selected, undefined)}>Download all ({downloadableDocuments.length})</a> : <span>No public downloads</span>}{filteredDownloadableDocuments.length > 0 ? <a className="button-link secondary-link" href={projectDownloadUrl(selected, filteredDownloadableDocuments)}>Download filtered ({filteredDownloadableDocuments.length})</a> : <span>No matching public files</span>}</div></div>
      <div className="table-wrap"><table><thead><tr><th>Name</th><th>Category</th><th>Type</th><th>Size</th><th>Status</th><th>Action</th></tr></thead><tbody>{visibleDocuments.map((document) => <tr key={document.id}><td>{document.filename}</td><td>{document.category ?? 'Other'}</td><td>{document.mimeType ?? '-'}</td><td>{formatSize(document.sizeBytes)}</td><td>{document.downloadStatus}</td><td>{document.downloadable ? <a href={documentDownloadUrl(document)}>{document.source === 'live' ? 'Download' : document.downloadStatus === 'downloaded' ? 'Download' : 'Try live source'}</a> : document.viewerUrl ? <a href={document.viewerUrl} target="_blank" rel="noreferrer">View at source</a> : <span>View only</span>}</td></tr>)}</tbody></table></div>{visibleDocuments.length === 0 && <p className="notice">No documents match this filter.</p>}
    </>}</section>}
  </main>;
}

function isPublicDownload(document: ArchiveDocument): boolean { return document.downloadable; }
function projectDownloadUrl(project: ArchiveProject, documents?: ArchiveDocument[]): string {
  const parameters = new URLSearchParams();
  documents?.forEach((document) => parameters.append('documentId', document.id));
  const suffix = parameters.size ? `?${parameters}` : '';
  return `/api/${project.source === 'live' ? 'live' : 'archive'}/projects/${encodeURIComponent(project.projectNumber)}/download${suffix}`;
}
function documentDownloadUrl(document: ArchiveDocument): string { return document.source === 'live' ? `/api/live/documents/${document.id}/download?projectNumber=${encodeURIComponent(document.projectNumber)}` : `/api/archive/documents/${document.id}/download`; }
function hasNoProjectFilters(filters: ArchiveSearchOptions): boolean { return !filters.municipality && !filters.status && !filters.publicationType && filters.visibility === 'all'; }
function canUseLiveFallback(input: string): boolean { return /^(?:omv_)?\d{10}$/i.test(input.trim()) || /^https:\/\//i.test(input.trim()); }
function message(error: unknown): string { if (error instanceof ApiError && error.code === 'NOT_FOUND') return 'This project is not available in the archive or on the official site.'; if (error instanceof ApiError && error.code === 'VERIFICATION_REQUIRED') return 'Official browser verification is required before live fallback can be used. Run npm run authorize and update the web service session.'; return error instanceof Error ? error.message : 'The archive could not be queried.'; }
