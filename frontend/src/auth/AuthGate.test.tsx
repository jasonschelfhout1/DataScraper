// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('authentication boundary', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('shows the login screen after an unauthenticated session check', async () => {
    fetchMock.mockResolvedValueOnce(json({ authenticated: false }));
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Omgevingsloket Document Downloader' })).toBeTruthy();
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password');
  });

  it('reveals the scraper after successful login and clears the password field', async () => {
    fetchMock.mockResolvedValueOnce(json({ authenticated: false }));
    fetchMock.mockResolvedValueOnce(json({ authenticated: true, username: 'test-user' }));
    render(<App />);
    await screen.findByLabelText('Username');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'test-user' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('button', { name: 'Log out test-user' })).toBeTruthy();
  });

  it('shows a useful error and clears the password after failed login', async () => {
    fetchMock.mockResolvedValueOnce(json({ authenticated: false }));
    fetchMock.mockResolvedValueOnce(json({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' }, 401));
    render(<App />);
    const password = await screen.findByLabelText('Password');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'test-user' } });
    fireEvent.change(password, { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid username or password.');
    expect((password as HTMLInputElement).value).toBe('');
  });

  it('returns to login after logout or an authenticated API 401', async () => {
    fetchMock.mockResolvedValueOnce(json({ authenticated: false }));
    fetchMock.mockResolvedValueOnce(json({ authenticated: true, username: 'test-user' }));
    fetchMock.mockResolvedValueOnce(json({ projects: 0, currentlyPublicProjects: 0, documents: 0, archivedDocuments: 0, viewOnlyDocuments: 0, pendingDownloads: 0, failedDownloads: 0, pendingTasks: 0, paused: false }));
    fetchMock.mockResolvedValueOnce(json({ municipalities: [], statuses: [], publicationTypes: [] }));
    fetchMock.mockResolvedValueOnce(json({ authenticated: false }));
    render(<App />);
    await screen.findByLabelText('Username');
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'test-user' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('button', { name: 'Log out test-user' });
    fireEvent.click(screen.getByRole('button', { name: 'Log out test-user' }));
    expect(await screen.findByLabelText('Username')).toBeTruthy();

    fetchMock.mockResolvedValueOnce(json({ authenticated: true, username: 'test-user' }));
    fetchMock.mockResolvedValueOnce(json({ projects: 0, currentlyPublicProjects: 0, documents: 0, archivedDocuments: 0, viewOnlyDocuments: 0, pendingDownloads: 0, failedDownloads: 0, pendingTasks: 0, paused: false }));
    fetchMock.mockResolvedValueOnce(json({ municipalities: [], statuses: [], publicationTypes: [] }));
    fetchMock.mockResolvedValueOnce(json({ code: 'UNAUTHORIZED', message: 'Authentication required.' }, 401));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'test-user' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('button', { name: 'Log out test-user' });
    fireEvent.change(screen.getByLabelText('Search archive'), { target: { value: '2026045710' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByLabelText('Username')).toBeTruthy());
  });
});
