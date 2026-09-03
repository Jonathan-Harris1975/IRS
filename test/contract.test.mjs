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
