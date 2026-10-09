import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const validSha = 'a'.repeat(40);
const base = { ...process.env, CF_ACCOUNT_ID: '', CF_PAGES_PROJECT_NAME: '', CF_PAGES_API_TOKEN: '', GITHUB_SHA: validSha };

for (const [name, env] of [
  ['missing credentials', base],
  ['missing SHA', { ...base, GITHUB_SHA: '' }],
  ['short SHA', { ...base, GITHUB_SHA: 'abcdef' }],
  ['invalid SHA', { ...base, GITHUB_SHA: 'z'.repeat(40) }],
]) {
  test(`Pages watcher fails closed with ${name}`, () => {
    const result = spawnSync(process.execPath, ['scripts/watch-pages-deployment.mjs'], {
      cwd: process.cwd(), env, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /requires credentials and a full expected commit SHA/);
  });
}
