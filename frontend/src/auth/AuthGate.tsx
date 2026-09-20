import { useEffect, useState } from 'react';
import { api, onUnauthorized } from '../api';
import ScraperApp from '../ScraperApp';
import { Login } from './Login';

type AuthState =
  | { status: 'checking' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; username: string };

export function AuthGate() {
  const [state, setState] = useState<AuthState>({ status: 'checking' });

  useEffect(() => {
    let active = true;
    void api.authSession().then((session) => {
      if (!active) return;
      setState(session.authenticated && session.username ? { status: 'authenticated', username: session.username } : { status: 'unauthenticated' });
    }).catch(() => { if (active) setState({ status: 'unauthenticated' }); });
    return onUnauthorized(() => { if (active) setState({ status: 'unauthenticated' }); });
  }, []);

  async function login(username: string, password: string): Promise<void> {
    const session = await api.login(username, password);
    if (!session.authenticated || !session.username) throw new Error('Authentication did not complete.');
    setState({ status: 'authenticated', username: session.username });
  }

  async function logout(): Promise<void> {
    try { await api.logout(); } finally { setState({ status: 'unauthenticated' }); }
  }

  if (state.status === 'checking') return <main className="shell auth-shell"><p className="notice">Checking session…</p></main>;
  if (state.status === 'unauthenticated') return <Login onLogin={login} />;
  return <ScraperApp username={state.username} onLogout={logout} />;
}
