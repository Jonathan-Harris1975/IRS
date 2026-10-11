import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listDeploymentChecks,
  selectDeploymentCheck,
  watchConfiguration,
  watchDeployment,
} from '../scripts/pages-deployment.mjs';

const sha = 'a'.repeat(40);
const config = {
  token: 'fixture-token',
  repository: 'Jonathan-Harris1975/IRS',
  commitSha: sha,
  checkName: 'Cloudflare Pages',
  appSlug: 'cloudflare-workers-and-pages',
  maxAttempts: 2,
  pollMs: 5000,
  budgetMs: 30000,
};
const check = (overrides = {}) => ({
  id: 123,
  name: 'Cloudflare Pages',
  app: { slug: 'cloudflare-workers-and-pages' },
  head_sha: sha,
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-10-10T00:00:00Z',
  details_url: 'https://dash.cloudflare.com/account/pages/view/irs/deployment/123',
  ...overrides,
});
function fixture(responses) {
  let time = 0;
  const calls = [];
  const waits = [];
  return {
    calls, waits, now: () => time,
    sleep: async (ms) => { waits.push(ms); time += ms; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      assert.equal(url.origin, 'https://api.github.com');
      assert.match(url.pathname, /\/repos\/Jonathan-Harris1975\/IRS\/commits\/[a-f0-9]{40}\/check-runs$/);
      assert.equal(url.searchParams.get('per_page'), '100');
      assert.ok(url.searchParams.get('page'));
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers.authorization, 'Bearer fixture-token');
      assert.equal(options.headers['x-github-api-version'], '2022-11-28');
      assert.ok(responses.length, 'unexpected request');
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
const response = (runs) => Response.json({ total_count: runs.length, check_runs: runs });

test('reads authenticated exact-commit check runs from GitHub', async () => {
  const mock = fixture([response([check()])]);
  assert.deepEqual(await listDeploymentChecks(config, mock), [check()]);
  assert.equal(mock.calls.length, 1);
});

test('accepts only the Cloudflare app check with exact name and SHA', () => {
  const ignored = [
    check({ id: 124, app: { slug: 'github-actions' } }),
    check({ id: 125, name: 'Other check' }),
  ];
  assert.equal(selectDeploymentCheck(ignored, config), null);
  assert.throws(() => selectDeploymentCheck([check({ head_sha: 'b'.repeat(40) })], config), /identity/);
  assert.equal(selectDeploymentCheck([check()], config).state, 'success');
});

test('waits for a pending exact-SHA Cloudflare check and then succeeds', async () => {
  const pending = check({ status: 'in_progress', conclusion: null });
  const mock = fixture([response([pending]), response([check()])]);
  assert.equal((await watchDeployment(config, mock)).status, 'success');
  assert.deepEqual(mock.waits, [5000]);
});

test('a newer failing check prevents acceptance of an older success', async () => {
  const oldSuccess = check({ id: 1, created_at: '2026-10-10T00:00:00Z' });
  const newestFailure = check({ id: 2, conclusion: 'failure', created_at: '2026-10-11T00:00:00Z' });
  assert.equal(selectDeploymentCheck([oldSuccess, newestFailure], config).state, 'failed');
  const mock = fixture([response([oldSuccess, newestFailure])]);
  assert.equal((await watchDeployment(config, mock)).status, 'failed');
  assert.equal(mock.waits.length, 0);
});

test('a newer in-progress check prevents stale success', async () => {
  const oldSuccess = check({ id: 1, created_at: '2026-10-10T00:00:00Z' });
  const newestPending = check({ id: 2, status: 'queued', conclusion: null, created_at: '2026-10-11T00:00:00Z' });
  assert.equal(selectDeploymentCheck([oldSuccess, newestPending], config).state, 'pending');
});

test('ambiguous newest provider checks fail closed', () => {
  assert.throws(() => selectDeploymentCheck([
    check({ id: 1 }), check({ id: 2 }),
  ], config), /Ambiguous/);
});

test('provider check identity and link are validated', () => {
  assert.throws(() => selectDeploymentCheck([check({ head_sha: 'b'.repeat(40) })], config), /identity/);
  assert.throws(() => selectDeploymentCheck([check({ details_url: 'http://dash.cloudflare.com/x' })], config), /untrusted/);
  assert.throws(() => selectDeploymentCheck([check({ details_url: 'https://attacker.example/x' })], config), /untrusted/);
  assert.throws(() => selectDeploymentCheck([check({ status: 'completed', conclusion: null })], config), /no conclusion/);
});

test('completed non-success conclusions fail closed', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required', 'neutral']) {
    const mock = fixture([response([check({ conclusion })])]);
    const result = await watchDeployment(config, mock);
    assert.equal(result.status, 'failed');
    assert.equal(result.conclusion, conclusion);
  }
});

test('transient GitHub outages retry within the bounded watch window', async () => {
  const mock = fixture([new Response(null, { status: 503 }), response([check()])]);
  assert.equal((await watchDeployment(config, mock)).status, 'success');
  assert.deepEqual(mock.waits, [5000]);
});

test('permission failures are surfaced without retry', async () => {
  const mock = fixture([new Response(null, { status: 403 })]);
  await assert.rejects(listDeploymentChecks(config, mock), /HTTP 403/);
  assert.equal(mock.calls.length, 1);
});

test('invalid and oversized responses fail closed', async () => {
  await assert.rejects(listDeploymentChecks(config, fixture([Response.json({})])));
  await assert.rejects(listDeploymentChecks(config, fixture([
    Response.json({ total_count: 101, check_runs: Array.from({ length: 100 }, (_, i) => check({ id: i + 1 })) }),
    Response.json({ total_count: 101, check_runs: [] }),
  ])), /did not return all check-run pages/);
});

test('check runs paginate safely beyond the first 100 results', async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => check({ id: index + 1 }));
  const secondPage = [check({ id: 101, conclusion: 'failure' })];
  const mock = fixture([
    Response.json({ total_count: 101, check_runs: firstPage }),
    Response.json({ total_count: 101, check_runs: secondPage }),
  ]);
  const runs = await listDeploymentChecks(config, mock);
  assert.equal(runs.length, 101);
  assert.equal(mock.calls[0].url.searchParams.get('page'), '1');
  assert.equal(mock.calls[1].url.searchParams.get('page'), '2');
});

test('programming TypeError fails immediately while a coded network error retries', async () => {
  const programmingError = new TypeError('config.token is undefined');
  const programming = fixture([programmingError]);
  await assert.rejects(watchDeployment(config, programming), /config.token is undefined/);
  assert.equal(programming.calls.length, 1);
  assert.deepEqual(programming.waits, []);

  const networkCause = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
  const networkError = new TypeError('fetch failed', { cause: networkCause });
  const network = fixture([networkError, response([check()])]);
  assert.equal((await watchDeployment(config, network)).status, 'success');
  assert.deepEqual(network.waits, [5000]);
});

test('watch timeout is bounded and does not sleep after its final attempt', async () => {
  const mock = fixture([response([]), response([])]);
  assert.equal((await watchDeployment(config, mock)).status, 'timeout');
  assert.deepEqual(mock.waits, [5000]);
});

test('configuration rejects missing identity, token and invalid runtime bounds', () => {
  const env = {
    GITHUB_TOKEN: 'token',
    GITHUB_REPOSITORY: 'Jonathan-Harris1975/IRS',
    GITHUB_SHA: sha,
  };
  assert.equal(watchConfiguration(env).budgetMs, 1080000);
  for (const invalid of [
    { ...env, GITHUB_TOKEN: '' },
    { ...env, GITHUB_REPOSITORY: 'wrong' },
    { ...env, GITHUB_SHA: 'abcdef' },
    { ...env, GITHUB_SHA: 'z'.repeat(40) },
    { ...env, CF_DEPLOYMENT_MAX_ATTEMPTS: '71' },
    { ...env, CF_DEPLOYMENT_POLL_MS: '1' },
  ]) assert.throws(() => watchConfiguration(invalid));
});
