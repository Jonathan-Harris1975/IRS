import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const watcher = readFileSync(new URL('../scripts/watch-pages-deployment.mjs', import.meta.url), 'utf8');

test('deployment history uses bounded pagination and refuses incomplete history', () => {
  assert.match(watcher, /page <= 20/);
  assert.match(watcher, /searchParams\.set\('page'/);
  assert.match(watcher, /result_info\?\.total_pages/);
  assert.match(watcher, /pagination limit reached/);
  assert.match(watcher, /history exceeds bounded pagination limit/);
});

test('Cloudflare requests have a finite timeout and fail on API errors', () => {
  assert.match(watcher, /AbortSignal\.timeout\(15000\)/);
  assert.match(watcher, /if \(!response\.ok\) throw/);
});
