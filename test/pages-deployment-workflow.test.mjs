import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/pages-deployment-watch.yml', 'utf8');

function stepBody(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = workflow.match(
    new RegExp(`- name: ${escaped}\\n([\\s\\S]*?)(?=\\n      - (?:name:|uses:|if:)|\\n\\n  [a-zA-Z_]|$)`),
  );
  assert.ok(match, `workflow step not found: ${name}`);
  return match[1];
}

test('automatic Pages verification fails closed for every required value', () => {
  const config = stepBody('Check Cloudflare Pages deployment-watch configuration');
  for (const name of ['CF_ACCOUNT_ID', 'CF_PAGES_PROJECT_NAME', 'CF_PAGES_API_TOKEN']) {
    assert.match(config, new RegExp(`\\b${name}\\b`));
  }
  assert.match(config, /missing=\(\)/);
  assert.match(config, /exit 1/);
  assert.match(config, /::error::Cloudflare Pages deployment verification cannot run/);
  assert.doesNotMatch(config, /::warning::|configured=false|skipp(?:ed|ing)/i);
});

test('exact-SHA watch and target audit both precede production attestation', () => {
  const watchIndex = workflow.indexOf('- name: Watch the production Pages deployment');
  const auditIndex = workflow.indexOf('- name: Audit every authorised live redirect target');
  const attestationIndex = workflow.indexOf('- name: Record exact-SHA Pages deployment attestation');

  assert.ok(watchIndex > 0 && auditIndex > watchIndex && attestationIndex > auditIndex);
  assert.match(stepBody('Watch the production Pages deployment'), /GITHUB_SHA:[\s\S]*workflow_run\.head_sha/);
  assert.match(stepBody('Record exact-SHA Pages deployment attestation'), /DEPLOYED_SHA:[\s\S]*workflow_run\.head_sha/);
  assert.doesNotMatch(stepBody('Record exact-SHA Pages deployment attestation'), /if:/);
});

test('target health cannot substitute for deployment verification', () => {
  const configIndex = workflow.indexOf('- name: Check Cloudflare Pages deployment-watch configuration');
  const watchIndex = workflow.indexOf('- name: Watch the production Pages deployment');
  const auditIndex = workflow.indexOf('- name: Audit every authorised live redirect target');
  assert.ok(configIndex > 0 && watchIndex > configIndex && auditIndex > watchIndex);
  assert.match(workflow, /run: npm run watch:pages/);
  assert.match(workflow, /run: npm run audit:targets/);
});

test('optional dispatch is downstream of retained mandatory evidence', () => {
  const evidenceIndex = workflow.indexOf('- name: Upload redirect target audit');
  const dispatchIndex = workflow.indexOf(
    '- name: Trigger central ecosystem smoke when cross-repository dispatch is configured',
  );
  assert.ok(evidenceIndex > 0 && dispatchIndex > evidenceIndex);
  const dispatch = stepBody(
    'Trigger central ecosystem smoke when cross-repository dispatch is configured',
  );
  assert.match(dispatch, /exit 0/);
  assert.match(dispatch, /optional cross-repository MAST dispatch was skipped/);
});
