import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';
import { api, ApiError } from './api';
import { filterDocuments, formatSize } from './filter';
import type { Document, DownloadJob, Project } from './types';

interface ScraperAppProps { username: string; onLogout: () => Promise<void> }

function messageFor(error: unknown): string {
  if (error instanceof ApiError && error.code === 'DISCOVERY_REQUIRED') return 'The public API mapping has not been confirmed yet. Run the authorized discovery workflow before searching.';
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

export default function ScraperApp({ username, onLogout }: ScraperAppProps) {
  const [input, setInput] = useState('');
  const [project, setProject] = useState<Project>();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string>();
  const [job, setJob] = useState<DownloadJob>();

  const visible = useMemo(() => filterDocuments(documents, query, category), [documents, query, category]);
  const categories = useMemo(() => ['All', ...Array.from(new Set(documents.map((document) => document.category ?? 'Other'))).sort()], [documents]);
  const selectableVisible = visible.filter((document) => document.downloadable);

  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const events = new EventSource(`/api/downloads/${job.id}/events`);
    events.onmessage = (event) => setJob(JSON.parse(event.data) as DownloadJob);
    events.onerror = () => events.close();
    return () => events.close();
  }, [job?.id, job?.status]);

  async function search(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!input.trim()) return;
    setLoading(true); setDiscovering(false); setError(undefined); setProject(undefined); setDocuments([]); setSelected(new Set()); setJob(undefined);
    try {
      const foundProject = await api.project(input.trim());
      setProject(foundProject);
      setDiscovering(true);
      setDocuments(await api.documents(foundProject.projectNumber));
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setLoading(false); setDiscovering(false);
    }
  }
  function toggle(id: string): void {
    setSelected((previous) => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function toggleVisible(): void {
    const ids = selectableVisible.map((document) => document.id);
    const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((previous) => { const next = new Set(previous); ids.forEach((id) => allSelected ? next.delete(id) : next.add(id)); return next; });
  }
  async function download(ids = [...selected]): Promise<void> {
    if (!project || !ids.length) return;
    setError(undefined);
    try { setJob(await api.startDownload(project.projectNumber, ids)); } catch (cause) { setError(messageFor(cause)); }
  }

  return <main className="shell">
    <header className="app-header"><div><p className="eyebrow">PRIVATE DOCUMENT UTILITY</p><h1>Omgevingsloket Document Downloader</h1><p>Find and download only files that the public Inzageloket makes available.</p></div><button className="secondary logout" type="button" onClick={() => void onLogout()}>Log out {username}</button></header>
    <form className="search" onSubmit={search}>
      <label htmlFor="project">Project number or Omgevingsloket URL</label>
      <div><input id="project" value={input} onChange={(event) => setInput(event.target.value)} placeholder="2026045710" autoComplete="off" /><button disabled={loading}>{loading ? 'Searching…' : 'Search project'}</button></div>
    </form>
    {error && <p className="notice error" role="alert">{error}</p>}
    {loading && <p className="notice">Searching project…</p>}
    {project && <section className="project"><h2>{project.title ?? `Project ${project.projectNumber}`}</h2><dl><Data label="Project number" value={project.projectNumber} /><Data label="Description" value={project.description} /><Data label="Location" value={project.address} /><Data label="Municipality" value={project.municipality} /><Data label="Status" value={project.status} /></dl></section>}
    {discovering && <p className="notice">Discovering publicly accessible documents…</p>}
    {project && !discovering && <section className="documents">
      <div className="section-head"><h2>{documents.length} document{documents.length === 1 ? '' : 's'} found</h2><div className="filters"><input aria-label="Search documents" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents…" /><select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></div></div>
      {documents.length === 0 ? <p className="notice">No publicly accessible documents were found.</p> : <>
        <div className="table-wrap"><table><thead><tr><th><input aria-label="Select visible documents" type="checkbox" checked={selectableVisible.length > 0 && selectableVisible.every((document) => selected.has(document.id))} onChange={toggleVisible} /></th><th>Name</th><th>Category</th><th>Description</th><th>Type</th><th>Size</th><th>Actions</th></tr></thead>
          <tbody>{visible.map((document) => <tr key={document.id}><td><input aria-label={`Select ${document.name}`} type="checkbox" disabled={!document.downloadable} checked={selected.has(document.id)} onChange={() => toggle(document.id)} /></td><td>{document.name}</td><td>{document.category ?? 'Other'}</td><td>{document.description ?? '—'}</td><td>{document.mimeType ?? '—'}</td><td>{formatSize(document.size)}</td><td className="actions">{document.viewerUrl && <a href={document.viewerUrl} target="_blank" rel="noreferrer">View</a>}{document.downloadable ? <a href={`/api/projects/${project.projectNumber}/documents/${document.id}/download`}>Download</a> : <span>View only</span>}</td></tr>)}</tbody>
        </table></div>
        <footer className="selection"><span>{selected.size} document{selected.size === 1 ? '' : 's'} selected</span><div><button className="secondary" type="button" onClick={() => setSelected(new Set())}>Clear selection</button><button className="secondary" type="button" onClick={() => download(documents.filter((document) => document.downloadable).map((document) => document.id))}>Download all</button><button type="button" onClick={() => download()} disabled={!selected.size}>Download selected</button></div></footer>
      </>}
    </section>}
    {job && <section className="job"><h2>{job.status === 'running' ? `Downloading ${job.completed} / ${job.total}` : job.status === 'completed' ? 'Archive ready' : 'Archive failed'}</h2><p>Downloaded: {job.completed - job.failures.length} · Failed: {job.failures.length}</p>{job.downloadUrl && <a className="button-link" href={job.downloadUrl}>Download ZIP</a>}{job.failures.length > 0 && <button type="button" onClick={() => download(job.failures.map((failure) => failure.documentId))}>Retry failed documents</button>}</section>}
  </main>;
}

function Data({ label, value }: { label: string; value?: string }): ReactElement | null {
  return value ? <><dt>{label}</dt><dd>{value}</dd></> : null;
}
