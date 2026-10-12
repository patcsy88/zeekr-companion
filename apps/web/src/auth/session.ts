/**
 * Bearer token held in module memory ONLY. Never written to localStorage, sessionStorage,
 * IndexedDB or a cookie, and the password is never stored anywhere (ADR-002).
 */
export interface SessionState {
  signedIn: boolean;
  /** True after a 401 or token expiry: the queue is paused until the user signs in again. */
  needsLogin: boolean;
}

let token: string | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let state: SessionState = { signedIn: false, needsLogin: false };
const listeners = new Set<() => void>();

function publish(next: SessionState): void {
  if (next.signedIn === state.signedIn && next.needsLogin === state.needsLogin) return;
  state = next;
  for (const l of [...listeners]) l();
}

export function getToken(): string | null {
  return token;
}

export function setToken(value: string, expiresInSeconds: number): void {
  token = value;
  clearTimeout(timer);
  // Expire slightly early so a request never carries a token that dies in flight.
  timer = setTimeout(expire, Math.max(1, expiresInSeconds - 30) * 1000);
  publish({ signedIn: true, needsLogin: false });
}

/** Called on 401 or expiry. */
export function expire(): void {
  token = null;
  clearTimeout(timer);
  publish({ signedIn: false, needsLogin: true });
}

export function requestLogin(): void {
  publish({ ...state, needsLogin: true });
}

export function signOut(): void {
  token = null;
  clearTimeout(timer);
  publish({ signedIn: false, needsLogin: false });
}

export function getSession(): SessionState {
  return state;
}

export function subscribeSession(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
