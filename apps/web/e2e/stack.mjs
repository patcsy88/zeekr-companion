// Disposable e2e stack: throwaway Postgres (docker) + the real API (services/api/.venv) + vite preview
// of the PRODUCTION build. Everything is random and thrown away on exit. No real data is touched.
// Needs: docker, services/api/.venv, and a built apps/web/dist (npm run build).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const webDir = resolve(here, '..');
const apiDir = resolve(webDir, '../../services/api');
const py = resolve(apiDir, '.venv/bin/python');
const PASSWORD = process.env.E2E_PASSWORD ?? 'e2e-' + randomBytes(9).toString('hex');
const API_PORT = Number(process.env.E2E_API_PORT ?? 18765);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 4173);
const name = `zc-e2e-pg-${randomBytes(4).toString('hex')}`;
const children = [];

function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
    s.on('error', fail);
  });
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const c of children) c.kill('SIGTERM');
  spawnSync('docker', ['rm', '-f', '-v', name], { stdio: 'ignore' });
}
// Playwright stops the web server with SIGTERM (SIGKILL after a timeout). Remove the container
// on every path we can catch. A container left by a hard kill is named zc-e2e-pg-* and is --rm.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    cleanup();
    process.exit(0);
  });
}
process.on('exit', cleanup);
process.on('uncaughtException', (e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});

const dbPassword = randomBytes(12).toString('hex');
const dbPort = await freePort();
const run = spawnSync('docker', [
  'run',
  '-d',
  '--rm',
  '--name',
  name,
  '-e',
  'POSTGRES_USER=e2e',
  '-e',
  `POSTGRES_PASSWORD=${dbPassword}`,
  '-e',
  'POSTGRES_DB=e2e',
  '-p',
  `127.0.0.1:${dbPort}:5432`,
  'postgres:17-alpine',
]);
if (run.status !== 0) {
  console.error('could not start throwaway postgres:', String(run.stderr));
  process.exit(1);
}
for (let i = 0; ; i++) {
  const r = spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'e2e', '-d', 'e2e']);
  if (r.status === 0) break;
  if (i > 60) {
    console.error('postgres did not become ready');
    process.exit(1);
  }
  await new Promise((r2) => setTimeout(r2, 500));
}
await new Promise((r) => setTimeout(r, 1500)); // pg_isready can pass during init restart

const hash = spawnSync(
  py,
  [
    '-c',
    'import sys;from app.security import hash_password;print(hash_password(sys.argv[1]))',
    PASSWORD,
  ],
  { cwd: apiDir },
);
if (hash.status !== 0) {
  console.error(String(hash.stderr));
  process.exit(1);
}

const env = {
  ...process.env,
  DATABASE_URL: `postgresql+psycopg://e2e:${dbPassword}@127.0.0.1:${dbPort}/e2e`,
  OWNER_PASSWORD_HASH: String(hash.stdout).trim(),
  TOKEN_SECRET: randomBytes(32).toString('hex'),
  LOGIN_MAX_FAILURES: '100',
};
const mig = spawnSync(resolve(apiDir, '.venv/bin/alembic'), ['upgrade', 'head'], {
  cwd: apiDir,
  env,
  stdio: 'inherit',
});
if (mig.status !== 0) process.exit(1);

children.push(
  spawn(
    resolve(apiDir, '.venv/bin/uvicorn'),
    ['app.asgi:app', '--host', '127.0.0.1', '--port', String(API_PORT)],
    { cwd: apiDir, env, stdio: 'inherit' },
  ),
);
children.push(
  spawn(
    resolve(webDir, 'node_modules/.bin/vite'),
    ['preview', '--strictPort', '--port', String(WEB_PORT)],
    {
      cwd: webDir,
      env: { ...process.env, API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      stdio: 'inherit',
    },
  ),
);
console.log(`e2e stack up: web :${WEB_PORT} api :${API_PORT}`);
await new Promise(() => undefined);
