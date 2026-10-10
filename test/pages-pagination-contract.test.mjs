import assert from 'node:assert/strict';
import test from 'node:test';
import { listDeployments, selectDeployment, watchConfiguration, watchDeployment } from '../scripts/pages-deployment.mjs';

const sha = 'a'.repeat(40);
const config = { accountId: 'account', projectName: 'irs', token: 'fixture', commitSha: sha, maxAttempts: 2, pollMs: 5000, budgetMs: 30000 };
const deployment = (overrides = {}) => ({
  id: 'current', project_name: 'irs', environment: 'production', created_on: '2026-10-10T00:00:00Z',
  deployment_trigger: { metadata: { branch: 'main', commit_hash: sha } }, latest_stage: { name: 'deploy', status: 'success' }, ...overrides,
});
const response = (items, info) => Response.json({ success: true, result: items, ...(info ? { result_info: info } : {}) });
function fixture(responses) {
  let time = 0;
  const calls = [];
  const waits = [];
  return {
    calls, waits, now: () => time,
    sleep: async (ms) => { waits.push(ms); time += ms; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      assert.equal(url.origin, 'https://api.cloudflare.com');
      assert.equal(url.searchParams.get('per_page'), '20');
      assert.equal(url.searchParams.get('env'), 'production');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      assert.ok(responses.length, 'unexpected request');
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

test('pagination reads later pages and deduplicates deployment IDs', async () => {
  const item = deployment();
  const next = deployment({ id: 'old', created_on: '2026-10-09T00:00:00Z' });
  const mock = fixture([response([item], { page: 1, total_pages: 2 }), response([item, next], { page: 2, total_pages: 2 })]);
  assert.equal((await listDeployments(config, mock)).length, 2);
  assert.deepEqual(mock.calls.map((call) => call.url.searchParams.get('page')), ['1', '2']);
});

test('fallback pagination exhausts full pages', async () => {
  const mock = fixture([response(Array.from({ length: 20 }, (_, i) => deployment({ id: String(i) }))), response([])]);
  assert.equal((await listDeployments(config, mock)).length, 20);
  assert.equal(mock.calls.length, 2);
});

for (const [name, bodies] of [
  ['history over bound', [response([], { total_pages: 21 })]],
  ['wrong page', [response([], { page: 2 })]],
  ['bad metadata', [response([], { total_pages: '2' })]],
  ['missing identity', [response([{}])]],
  ['conflicting identity', [response([deployment(), deployment({ environment: 'preview' })])]],
  ['provider error envelope', [Response.json({ success: false, result: [] })]],
  ['malformed JSON', [new Response('{')]],
]) test(`fails closed: ${name}`, async () => { await assert.rejects(listDeployments(config, fixture(bodies))); });

test('unexhausted history fails after 20 pages', async () => {
  const full = () => response(Array.from({ length: 20 }, (_, i) => deployment({ id: String(i) })));
  const mock = fixture(Array.from({ length: 20 }, full));
  await assert.rejects(listDeployments(config, mock), /pagination limit/);
  assert.equal(mock.calls.length, 20);
});

for (const status of [400, 401, 403, 404]) test(`HTTP ${status} fails without retry`, async () => {
  const mock = fixture([new Response(null, { status })]);
  await assert.rejects(listDeployments(config, mock), new RegExp(`HTTP ${status}`));
  assert.equal(mock.calls.length, 1);
});

for (const status of [429, 500, 503]) test(`HTTP ${status} retries and recovers`, async () => {
  const mock = fixture([new Response(null, { status, headers: { 'retry-after': '2' } }), response([deployment()])]);
  assert.equal((await watchDeployment(config, mock)).status, 'success');
  assert.deepEqual(mock.waits, [2000]);
});

test('outage stops after three attempts with exponential backoff', async () => {
  const mock = fixture([503, 503, 503].map((status) => new Response(null, { status })));
  await assert.rejects(listDeployments(config, mock), /HTTP 503/);
  assert.equal(mock.calls.length, 3);
  assert.deepEqual(mock.waits, [1000, 2000]);
});

test('request timeout retries safely and recovers', async () => {
  const mock = fixture([new DOMException('fixture timeout', 'TimeoutError'), response([deployment()])]);
  assert.equal((await watchDeployment(config, mock)).status, 'success');
});

test('retry-after cannot overrun the global deadline', async () => {
  const mock = fixture([new Response(null, { status: 429, headers: { 'retry-after': '999999' } })]);
  await assert.rejects(listDeployments({ ...config, budgetMs: 1000 }, mock), /deadline/);
  assert.equal(mock.waits.length, 0);
});

test('newer wrong SHA prevents stale success despite shuffled order', () => {
  const stale = deployment({ id: 'old', created_on: '2026-10-09T00:00:00Z' });
  const fresh = deployment({ deployment_trigger: { metadata: { branch: 'main', commit_hash: 'b'.repeat(40) } } });
  assert.equal(selectDeployment([stale, fresh], config), null);
});

for (const [name, changes] of [
  ['preview', { environment: 'preview' }],
  ['wrong branch', { deployment_trigger: { metadata: { branch: 'other', commit_hash: sha } } }],
  ['short SHA', { deployment_trigger: { metadata: { branch: 'main', commit_hash: 'aaaaaaa' } } }],
  ['missing SHA', { deployment_trigger: { metadata: { branch: 'main' } } }],
]) test(`${name} cannot attest production`, () => { assert.equal(selectDeployment([deployment(changes)], config), null); });

for (const [name, changes] of [
  ['wrong project', { project_name: 'wrong' }], ['invalid timestamp', { created_on: 'invalid' }],
  ['missing branch', { deployment_trigger: { metadata: { commit_hash: sha } } }],
]) test(`rejects ${name}`, () => { assert.throws(() => selectDeployment([deployment(changes)], config)); });

test('tied deployment creation timestamps fail closed', () => {
  assert.throws(() => selectDeployment([deployment(), deployment({ id: 'another' })], config), /Ambiguous/);
});

for (const status of ['failure', 'failed', 'error', 'canceled', 'cancelled', 'skipped']) test(`terminal ${status} fails`, async () => {
  const mock = fixture([response([deployment({ latest_stage: { name: 'build', status } })])]);
  assert.equal((await watchDeployment(config, mock)).status, 'failed');
  assert.equal(mock.waits.length, 0);
});

test('build success cannot substitute for deploy success', async () => {
  const mock = fixture([response([deployment({ latest_stage: { name: 'build', status: 'success' } })]), response([deployment()])]);
  assert.equal((await watchDeployment(config, mock)).attempts, 2);
});

test('timeout ends at attempt bound without final sleep', async () => {
  const mock = fixture([response([]), response([])]);
  assert.equal((await watchDeployment(config, mock)).status, 'timeout');
  assert.deepEqual(mock.waits, [5000]);
});

test('configuration rejects non-finite, zero and excessive runtime bounds', () => {
  const env = { CF_ACCOUNT_ID: 'account', CF_PAGES_PROJECT_NAME: 'irs', CF_PAGES_API_TOKEN: 'testing', GITHUB_SHA: sha };
  for (const value of ['NaN', 'Infinity', '0', '71', '1.5']) assert.throws(() => watchConfiguration({ ...env, CF_DEPLOYMENT_MAX_ATTEMPTS: value }));
  assert.equal(watchConfiguration(env).budgetMs, 1080000);
});
