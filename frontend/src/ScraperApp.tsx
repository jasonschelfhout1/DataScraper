import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from './api';
import { formatSize } from './filter';
import type { ArchiveDocument, ArchiveProject, ArchiveStats } from './types';

interface ScraperAppProps { username: string; onLogout: () => Promise<void> }

export default function ScraperApp({ username, onLogout }: ScraperAppProps) {
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<ArchiveProject[]>([]);
  const [selected, setSelected] = useState<ArchiveProject>();
  const [documents, setDocuments] = useState<ArchiveDocument[]>([]);
  const [stats, setStats] = useState<ArchiveStats>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => { void api.archiveStatus().then(setStats).catch(() => undefined); }, []);
  async function search(event: FormEvent): Promise<void> { event.preventDefault(); setLoading(true); setError(undefined); setSelected(undefined); setDocuments([]); try { setProjects((await api.searchArchive(query)).projects); } catch (cause) { setError(message(cause)); } finally { setLoading(false); } }
  async function open(project: ArchiveProject): Promise<void> { setSelected(project); setLoading(true); setError(undefined); try { setDocuments(await api.archiveDocuments(project.projectNumber)); } catch (cause) { setError(message(cause)); } finally { setLoading(false); } }

  return <main className="shell">
    <header className="app-header"><div><p className="eyebrow">PRIVATE ARCHIVE</p><h1>Omgevingsloket Archive</h1><p>Historical copies of publicly downloadable Inzageloket documents observed by this archive. Source availability and copyright restrictions still apply.</p></div><button className="secondary logout" type="button" onClick={() => void onLogout()}>Log out {username}</button></header>
    {stats && <section className="project archive-status"><strong>{stats.projects.toLocaleString()} projects</strong><span>{stats.archivedDocuments.toLocaleString()} archived documents</span><span>{stats.viewOnlyDocuments.toLocaleString()} view-only metadata records</span><span>{stats.paused ? `Crawler paused: ${stats.pauseReason ?? 'authorization required'}` : `${stats.pendingTasks} tasks queued`}</span></section>}
    <form className="search" onSubmit={search}><label htmlFor="archive-search">Search project number, municipality or project name</label><div><input id="archive-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Antwerpen or 2026045710" /><button disabled={loading}>{loading ? 'Searching…' : 'Search archive'}</button></div></form>
    {error && <p className="notice error" role="alert">{error}</p>}
    {projects.length > 0 && <section className="documents"><h2>Archive results</h2>{projects.map((project) => <button type="button" className="archive-result" key={project.id} onClick={() => void open(project)}><strong>{project.projectNumber}</strong><span>{project.title ?? 'Untitled project'}</span><span>{project.municipality ?? 'Municipality unavailable'}</span><small>Last seen {new Date(project.lastSeenAt).toLocaleDateString()} · {project.documentCount ?? 0} documents</small></button>)}</section>}
    {selected && <section className="documents"><h2>{selected.title ?? `Project ${selected.projectNumber}`}</h2><p>{selected.isCurrentlyPublic ? 'Currently observed as public' : 'No longer observed as public'} · First seen {new Date(selected.firstSeenAt).toLocaleDateString()} · Last synchronized {selected.lastCrawledAt ? new Date(selected.lastCrawledAt).toLocaleString() : 'not yet crawled'}</p>{documents.length === 0 ? <p className="notice">No documents are archived for this project yet.</p> : <div className="table-wrap"><table><thead><tr><th>Name</th><th>Category</th><th>Type</th><th>Size</th><th>Status</th><th>Action</th></tr></thead><tbody>{documents.map((document) => <tr key={document.id}><td>{document.filename}</td><td>{document.category ?? 'Other'}</td><td>{document.mimeType ?? '—'}</td><td>{formatSize(document.sizeBytes)}</td><td>{document.downloadStatus}</td><td>{document.downloadable && document.downloadStatus === 'downloaded' ? <a href={`/api/archive/documents/${document.id}/download`}>Download</a> : document.viewerUrl ? <a href={document.viewerUrl} target="_blank" rel="noreferrer">View at source</a> : <span>View only</span>}</td></tr>)}</tbody></table></div>}</section>}
  </main>;
}

function message(error: unknown): string { if (error instanceof ApiError && error.code === 'NOT_FOUND') return 'This project is not archived yet. Searching never triggers a live Omgevingsloket request.'; return error instanceof Error ? error.message : 'The archive could not be queried.'; }
