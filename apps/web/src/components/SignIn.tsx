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
import { OTPField, OTPFieldInput } from './ui/otp-field';

/** App codes are 6 digits (`services/api/app/totp.py` DIGITS). */
const CODE_LENGTH = 6;
const SLOTS = Array.from({ length: CODE_LENGTH }, (_, i) => `code-digit-${i}`);

export function SignIn({ reason }: { reason?: string }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Switching between an app code and a recovery code starts the code empty.
  function showRecovery() {
    setCode('');
    setRecovery(true);
  }
  function showApp() {
    setCode('');
    setRecovery(false);
  }

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
          {recovery ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">Recovery code</Label>
              <Input
                nativeInput
                size="lg"
                id="code"
                name="code"
                type="text"
                inputMode="text"
                autoComplete="off"
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
                One of the recovery codes you saved, such as xxxxx-xxxxx. Each works once.
              </p>
              <Button type="button" variant="link" className="self-start px-0" onClick={showApp}>
                Use an app code
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">Code</Label>
              <OTPField
                id="code"
                size="lg"
                length={CODE_LENGTH}
                value={code}
                onValueChange={setCode}
                aria-describedby="code-hint"
              >
                {SLOTS.map((slot, index) => (
                  <OTPFieldInput
                    key={slot}
                    aria-label={index === 0 ? undefined : `Digit ${index + 1} of ${CODE_LENGTH}`}
                  />
                ))}
              </OTPField>
              <p id="code-hint" className="m-0 text-muted-foreground text-sm">
                The 6 digits from your authenticator app. Leave empty if you have not set it up.
              </p>
              <Button
                type="button"
                variant="link"
                className="self-start px-0"
                onClick={showRecovery}
              >
                Use a recovery code
              </Button>
            </div>
          )}
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
