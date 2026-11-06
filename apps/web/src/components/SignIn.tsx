import { useState, type FormEvent } from 'react';
import { login } from '../api/endpoints';
import { ApiError } from '../api/client';
import { describeError } from '../api/errors';
import { setToken } from '../auth/session';

export function SignIn({ reason }: { reason?: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const t = await login(username, password, code);
      setToken(t.access_token, t.expires_in);
      setPassword(''); // the password and code are never kept
      setCode('');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Wrong username, password or code.'
          : describeError(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="signin-title" className="card narrow">
      <h1 id="signin-title">Sign in</h1>
      {reason ? <p className="muted">{reason}</p> : null}
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'signin-error' : undefined}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'signin-error' : undefined}
          />
        </div>
        <div className="field">
          <label htmlFor="code">Code</label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={64}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
            }}
            aria-describedby="code-hint"
          />
          <p id="code-hint" className="muted">
            From your authenticator app, or a recovery code. Leave empty if you have not set it up.
          </p>
        </div>
        {error ? (
          <p id="signin-error" role="alert" className="error">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="primary"
          disabled={busy || username.trim() === '' || password === ''}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  );
}
