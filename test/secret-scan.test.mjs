import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { formatFinding, loadAllowlist, scanRepository, scanText } from '../scripts/secret-scan.mjs';

const root = process.cwd();
const syntheticFixturePath = 'test/fixtures/secret-scan/synthetic-secrets.txt';
const safeFixturePath = 'test/fixtures/secret-scan/safe-placeholders.txt';
const syntheticFixture = [
  `github_token=${['ghp', 'A'.repeat(36)].join('_')}`,
  `aws_access_key=${['AKIA', 'ABCDEFGHIJKLMNOP'].join('')}`,
  `Authorization: Bearer ${['synthetic', 'Bearer', 'Token', 'Value', '1234567890'].join('')}`,
  `password=${['Synthetic', 'Password', 'For', 'Scanner', 'Only', '987654321'].join('-')}`,
].join('\n');
const safeFixture = fs.readFileSync(safeFixturePath, 'utf8');
const allowlist = loadAllowlist(path.join(root, 'config', 'secret-scan-allowlist.json'));

test('secret scanner detects representative synthetic credentials', () => {
  const { findings } = scanText(syntheticFixture, syntheticFixturePath, []);
  const detectors = new Set(findings.map((finding) => finding.detector));
  for (const detector of ['github-token', 'aws-access-key-id', 'bearer-token', 'credential-assignment']) {
    assert.equal(detectors.has(detector), true, `expected ${detector} detection`);
  }
});

test('secret scanner detects private-key material without committing a key-shaped fixture', () => {
  const boundary = ['PRIVATE', 'KEY'].join(' ');
  const body = 'A'.repeat(48);
  const syntheticPrivateKey = [`-----BEGIN ${boundary}-----`, body, `-----END ${boundary}-----`].join('\n');
  const { findings } = scanText(syntheticPrivateKey, '<generated-private-key-test>', []);
  assert.equal(findings.some((finding) => finding.detector === 'private-key'), true);
});

test('safe placeholders are not rejected', () => {
  const { findings } = scanText(safeFixture, safeFixturePath, []);
  assert.deepEqual(findings, []);
});

test('committed scanner fixture contains no credential-shaped literals', () => {
  const committedFixture = fs.readFileSync(syntheticFixturePath, 'utf8');
  const { findings } = scanText(committedFixture, syntheticFixturePath, []);
  assert.deepEqual(findings, []);
});

test('allow-list entries do not suppress an unrelated credential', () => {
  const unrelated = `password=${['unrelated', 'credential', 'value', '123456789'].join('-')}`;
  const { findings } = scanText(unrelated, syntheticFixturePath, allowlist);
  assert.equal(findings.some((finding) => finding.detector === 'credential-assignment'), true);
});

test('project vendor-token and webhook formats are detected when literals are committed', () => {
  const vendorName = ['CF', 'PAGES', 'API', 'TOKEN'].join('_');
  const vendorValue = ['synthetic', 'cloudflare', 'token', '1234567890'].join('-');
  const vendorResult = scanText(`${vendorName}=${vendorValue}`, 'memory.env', []);
  assert.equal(vendorResult.findings.some((finding) => finding.detector === 'credential-assignment'), true);

  const webhook = ['https://hooks.slack.com/services', 'T12345678', 'B12345678', 'SyntheticWebhookToken1234567890'].join('/');
  const webhookResult = scanText(webhook, 'memory.txt', []);
  assert.equal(webhookResult.findings.some((finding) => finding.detector === 'webhook-url'), true);
});

test('reported scanner output is redacted', () => {
  const raw = `Bearer ${'redaction' + 'TestTokenValue1234567890'}`;
  const { findings } = scanText(raw, 'memory.txt', []);
  assert.equal(findings.length, 1);
  const output = formatFinding(findings[0]);
  assert.match(output, /\[REDACTED/);
  assert.equal(output.includes('redactionTestTokenValue1234567890'), false);
});

test('real repository passes committed-secret scan with exact test-vector exceptions', () => {
  const result = scanRepository(root);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.staleAllowlist, []);
});
