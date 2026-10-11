import assert from 'node:assert/strict';
import { test } from 'node:test';
import { watchConfiguration } from '../scripts/pages-deployment.mjs';

const validSha = 'a'.repeat(40);
const base = {
  GITHUB_TOKEN: 'fixture-token',
  GITHUB_REPOSITORY: 'Jonathan-Harris1975/IRS',
  GITHUB_SHA: validSha,
};

test('configuration accepts the minimum GitHub identity and bounded defaults', () => {
  const config = watchConfiguration(base);
  assert.equal(config.repository, 'Jonathan-Harris1975/IRS');
  assert.equal(config.commitSha, validSha);
  assert.equal(config.checkName, 'Cloudflare Pages');
  assert.equal(config.appSlug, 'cloudflare-workers-and-pages');
  assert.equal(config.maxAttempts, 40);
  assert.equal(config.pollMs, 15000);
  assert.equal(config.budgetMs, 1080000);
});

for (const [name, env] of [
  ['missing GitHub token', { ...base, GITHUB_TOKEN: '' }],
  ['missing repository', { ...base, GITHUB_REPOSITORY: '' }],
  ['malformed repository', { ...base, GITHUB_REPOSITORY: 'owner//repo' }],
  ['missing SHA', { ...base, GITHUB_SHA: '' }],
  ['short SHA', { ...base, GITHUB_SHA: 'abcdef' }],
  ['invalid SHA', { ...base, GITHUB_SHA: 'z'.repeat(40) }],
  ['excessive poll attempts', { ...base, CF_DEPLOYMENT_MAX_ATTEMPTS: '71' }],
  ['too frequent polling', { ...base, CF_DEPLOYMENT_POLL_MS: '1' }],
]) {
  test('rejects ' + name, () => {
    assert.throws(() => watchConfiguration(env));
  });
}
