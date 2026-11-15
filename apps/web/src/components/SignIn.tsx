import { useState, type FormEvent } from 'react';
import { login } from '../api/endpoints';
import { ApiError } from '../api/client';
import { describeError } from '../api/errors';
import { setToken } from '../auth/session';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Card, CardDescription, CardHeader, CardPanel } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';

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
    <Card render={<section aria-labelledby="signin-title" />} className="mx-auto my-4 max-w-md">
      <CardHeader>
        <h1 id="signin-title" className="m-0 font-semibold text-2xl leading-none">
          Sign in
        </h1>
        {reason ? <CardDescription render={<p className="m-0" />}>{reason}</CardDescription> : null}
      </CardHeader>
      <CardPanel>
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="username">Username</Label>
            <Input
              nativeInput
              size="lg"
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              nativeInput
              size="lg"
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="code">Code</Label>
            <Input
              nativeInput
              size="lg"
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
            <p id="code-hint" className="m-0 text-muted-foreground text-sm">
              From your authenticator app, or a recovery code. Leave empty if you have not set it
              up.
            </p>
          </div>
          {error ? (
            <Alert variant="error" id="signin-error">
              <AlertDescription className="font-medium text-destructive-foreground">
                {error}
              </AlertDescription>
            </Alert>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={busy || username.trim() === '' || password === ''}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </CardPanel>
    </Card>
  );
}
