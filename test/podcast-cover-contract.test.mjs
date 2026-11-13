import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const canonical = 'https://podcast-coverart.jonathan-harris.online/cover-art-2026-11-13-3000.png';

test('podcast cover alias uses the same canonical cover as RSS and website', () => {
  const registry = JSON.parse(fs.readFileSync('data/image-url-map.json', 'utf8'));
  const redirects = fs.readFileSync('public/_redirects', 'utf8');
  const allowlist = JSON.parse(fs.readFileSync('config/allowed-destination-hosts.json', 'utf8'));

  assert.equal(registry['/podcast-img'], canonical);
  assert.ok(redirects.split(/\r?\n/).includes(`/podcast-img ${canonical} 301`));
  assert.ok(allowlist.hosts.includes(new URL(canonical).hostname));
});
