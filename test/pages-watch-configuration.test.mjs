import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const validSha = 'a'.repeat(40);
const base = {
  ...process.env,
  GITHUB_TOKEN: '',
  GITHUB_REPOSITORY: 'Jonathan-Harris1975/IRS',
  GITHUB_SHA: validSha,
};

for (const [name, env] of [
  ['missing GitHub token', base],
  ['missing repository', { ...base, GITHUB_TOKEN: 'test', GITHUB_REPOSITORY: '' }],
  ['missing SHA', { ...base, GITHUB_TOKEN: 'test', GITHUB_SHA: '' }],
  ['short SHA', { ...base, GITHUB_TOKEN: 'test', GITHUB_SHA: 'abcdef' }],
  ['invalid SHA', { ...base, GITHUB_TOKEN: 'test', GITHUB_SHA: 'z'.repeat(40) }],
]) {
  test('Pages watcher fails closed with ' + name, () => {
    const result = spawnSync(process.execPath, ['scripts/watch-pages-deployment.mjs'], {
      cwd: process.cwd(), env, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /requires a GitHub token, repository and full expected commit SHA/);
  });
}
