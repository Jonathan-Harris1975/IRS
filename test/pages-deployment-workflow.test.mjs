import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/pages-deployment-watch.yml', 'utf8');

function stepBody(name) {
  const escaped = name.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const match = workflow.match(
    new RegExp('- name: ' + escaped + '\\n([\\s\\S]*?)(?=\\n      - (?:name:|uses:|if:)|\\n\\n  [a-zA-Z_]|$)'),
  );
  assert.ok(match, 'workflow step not found: ' + name);
  return match[1];
}

test('provider verification reads the Cloudflare GitHub App check with minimum permissions', () => {
  assert.match(workflow, /permissions:\n  checks: read\n  contents: read/);
  const watch = stepBody('Watch the exact-SHA Cloudflare Pages provider check');
  assert.match(watch, /GITHUB_TOKEN:[\s\S]*github\.token/);
  assert.match(watch, /GITHUB_REPOSITORY:[\s\S]*github\.repository/);
  assert.match(watch, /GITHUB_SHA:[\s\S]*workflow_run\.head_sha/);
  assert.match(watch, /run: npm run watch:pages/);
  assert.doesNotMatch(workflow, /CF_PAGES_API_TOKEN|CF_ACCOUNT_ID|CF_PAGES_PROJECT_NAME/);
});

test('exact-SHA provider verification and target audit precede attestation', () => {
  const watchIndex = workflow.indexOf('- name: Watch the exact-SHA Cloudflare Pages provider check');
  const auditIndex = workflow.indexOf('- name: Audit every authorised live redirect target');
  const attestationIndex = workflow.indexOf('- name: Record exact-SHA Pages deployment attestation');
  assert.ok(watchIndex > 0 && auditIndex > watchIndex && attestationIndex > auditIndex);
  assert.match(stepBody('Record exact-SHA Pages deployment attestation'), /DEPLOYED_SHA:[\s\S]*workflow_run\.head_sha/);
  assert.doesNotMatch(stepBody('Record exact-SHA Pages deployment attestation'), /if:/);
});

test('a live target audit cannot substitute for a missing provider deployment check', () => {
  const watchIndex = workflow.indexOf('- name: Watch the exact-SHA Cloudflare Pages provider check');
  const auditIndex = workflow.indexOf('- name: Audit every authorised live redirect target');
  assert.ok(watchIndex > 0 && auditIndex > watchIndex);
  assert.match(workflow, /run: npm run watch:pages/);
  assert.match(workflow, /run: npm run audit:targets/);
});

test('optional dispatch remains downstream of retained mandatory evidence', () => {
  const evidenceIndex = workflow.indexOf('- name: Upload redirect target audit');
  const dispatchIndex = workflow.indexOf(
    '- name: Trigger central ecosystem verification when cross-repository dispatch is configured',
  );
  assert.ok(evidenceIndex > 0 && dispatchIndex > evidenceIndex);
  const dispatch = stepBody(
    'Trigger central ecosystem verification when cross-repository dispatch is configured',
  );
  assert.match(dispatch, /exit 0/);
  assert.match(dispatch, /cross-repository MAST OIDC verification dispatch was skipped/);
});

test('the provider-check window is bounded and fits inside the workflow timeout', () => {
  const jobTimeoutMinutes = Number(workflow.match(/timeout-minutes:\s*(\d+)/)[1]);
  const watch = stepBody('Watch the exact-SHA Cloudflare Pages provider check');
  const attempts = Number(watch.match(/CF_DEPLOYMENT_MAX_ATTEMPTS:\s*['"](\d+)['"]/)[1]);
  const pollMs = Number(watch.match(/CF_DEPLOYMENT_POLL_MS:\s*['"](\d+)['"]/)[1]);
  const windowMs = attempts * pollMs;
  assert.ok(windowMs >= 15 * 60 * 1000);
  assert.ok(windowMs <= jobTimeoutMinutes * 60 * 1000);
});

test('credentialed verification only follows successful same-repository main runs', () => {
  assert.match(workflow, /workflow_run\.head_branch == 'main'/);
  assert.match(workflow, /workflow_run\.head_repository\.full_name == github\.repository/);
});
