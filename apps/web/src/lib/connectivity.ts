/**
 * Reachability of the API as the user would perceive it. navigator.onLine alone is not enough:
 * the phone can be online while the server is down, so a failed request also marks us offline.
 */
export interface ConnectivityState {
  online: boolean;
}

let state: ConnectivityState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
};
const listeners = new Set<() => void>();

function set(online: boolean): void {
  if (state.online === online) return;
  state = { online };
  for (const l of [...listeners]) l();
}

export function reportReachable(reachable: boolean): void {
  set(reachable);
}

export function isOnline(): boolean {
  return state.online;
}

export function subscribeConnectivity(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getConnectivity(): ConnectivityState {
  return state;
}

export function watchBrowserConnectivity(): () => void {
  const on = () => set(true);
  const off = () => set(false);
  window.addEventListener('online', on);
  window.addEventListener('offline', off);
  set(navigator.onLine);
  return () => {
    window.removeEventListener('online', on);
    window.removeEventListener('offline', off);
  };
}

export function resetConnectivityForTests(): void {
  state = { online: true };
  listeners.clear();
}
