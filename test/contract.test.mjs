import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('health contract is static and cache-safe', () => {
  const health = JSON.parse(fs.readFileSync('public/health.json', 'utf8'));
  assert.equal(health.status, 'healthy');
  assert.equal(health.service, 'IRS');
  assert.equal(health.ok, true);
});

test('headers prevent caching and indexing of health response', () => {
  const headers = fs.readFileSync('public/_headers', 'utf8');
  assert.match(headers, /\/health\.json/);
  assert.match(headers, /Cache-Control:\s*no-store/i);
  assert.match(headers, /X-Robots-Tag:\s*noindex/i);
});

test('redirect registry has one canonical source', () => {
  assert.equal(fs.existsSync('data/image-url-map.json'), true);
  assert.equal(fs.existsSync('image-url-map.json'), false);
});

test('CI uses the dedicated secret scanner instead of the legacy grep gate', () => {
  const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(packageJson.scripts['scan:secrets'], /scripts\/secret-scan\.mjs/);
  assert.match(packageJson.scripts.verify, /npm run scan:secrets/);
  assert.match(workflow, /run:\s*npm run verify/);
  assert.doesNotMatch(workflow, /grep\s+-RIE|Reject committed secrets/);
});

test('release gate requires deterministic verification and the live target audit', () => {
  const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(workflow, /live_target_audit:/);
  assert.match(workflow, /run:\s*npm run audit:targets/);
  assert.match(workflow, /release_gate:[\s\S]*?needs:\s*\[verify,\s*live_target_audit\]/);
});


test('scheduled target audit is daily, serialised and persists a freshness signal', () => {
  const workflow = fs.readFileSync('.github/workflows/target-audit.yml', 'utf8');
  assert.match(workflow, /cron:\s*['"]17 6 \* \* \*['"]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /concurrency:[\s\S]*?group:\s*irs-scheduled-target-audit/);
  assert.match(workflow, /IRS_TARGET_TIMEOUT_MS:\s*['"]12000['"]/);
  assert.match(workflow, /IRS_TARGET_CONCURRENCY:\s*['"]4['"]/);
  assert.match(workflow, /name:\s*irs-target-status/);
  assert.match(workflow, /retention-days:\s*90/);
});

test('static liveness remains independent from target-audit status', () => {
  const health = JSON.parse(fs.readFileSync('public/health.json', 'utf8'));
  assert.equal(health.status, 'healthy');
  assert.equal('targetAudit' in health, false);
  assert.equal(fs.existsSync('public/irs-target-status.json'), false);
});
