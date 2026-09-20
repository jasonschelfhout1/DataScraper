import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '../api';

interface LoginProps {
  onLogin: (username: string, password: string) => Promise<void>;
}

export function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await onLogin(username, password);
      setPassword('');
    } catch (cause) {
      setPassword('');
      setError(cause instanceof ApiError && cause.code === 'INVALID_CREDENTIALS' ? 'Invalid username or password.' : 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="shell auth-shell">
    <section className="auth-card" aria-labelledby="login-title">
      <p className="eyebrow">PRIVATE UTILITY</p>
      <h1 id="login-title">Omgevingsloket Document Downloader</h1>
      <p>Sign in to access this private document utility.</p>
      <form className="login-form" onSubmit={submit}>
        <label htmlFor="username">Username</label>
        <input id="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" maxLength={100} required disabled={submitting} />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" maxLength={500} required disabled={submitting} />
        {error && <p className="notice error" role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </section>
  </main>;
}
