import assert from 'node:assert/strict';
import test from 'node:test';
import { declaredLength, fetchAuthorisedTarget, isAuthorisedUrl, isImageContentType, looksLikeImage } from '../scripts/check-targets.mjs';

test('final target URL must remain HTTPS on the authorised host', () => {
  assert.equal(isAuthorisedUrl('https://ik.imagekit.io/7lx48g355/example.webp'), true);
  assert.equal(isAuthorisedUrl('http://ik.imagekit.io/7lx48g355/example.webp'), false);
  assert.equal(isAuthorisedUrl('https://example.com/example.webp'), false);
  assert.equal(isAuthorisedUrl('https://user:secret@ik.imagekit.io/7lx48g355/example.webp'), false);
});

test('target MIME type must be an image', () => {
  assert.equal(isImageContentType('image/webp'), true);
  assert.equal(isImageContentType('image/png; charset=binary'), true);
  assert.equal(isImageContentType('text/html'), false);
});

test('image signatures reject HTML masquerading behind HTTP success', () => {
  assert.equal(looksLikeImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'), true);
  assert.equal(looksLikeImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'), true);
  assert.equal(looksLikeImage(Buffer.from('RIFF1234WEBP', 'ascii'), 'image/webp'), true);
  assert.equal(looksLikeImage(Buffer.from('<html>not an image</html>', 'utf8'), 'image/webp'), false);
});

test('declared length prefers Content-Range totals and handles missing length', () => {
  assert.equal(declaredLength(new Response(null, { headers: { 'content-range': 'bytes 0-511/2048', 'content-length': '512' } })), 2048);
  assert.equal(declaredLength(new Response(null, { headers: { 'content-length': '1024' } })), 1024);
  assert.equal(declaredLength(new Response(null)), null);
});

test('malformed target URLs return a structured error without a request', async () => {
  let requests = 0;
  const result = await fetchAuthorisedTarget('not a URL', {}, async () => {
    requests += 1;
    throw new Error('fetch must not run');
  });

  assert.deepEqual(result, {
    response: null,
    finalUrl: null,
    error: 'invalid-target-url',
  });
  assert.equal(requests, 0);
});


test('redirects to unauthorised hosts are rejected before a second request', async () => {
  const requested = [];
  const result = await fetchAuthorisedTarget('https://ik.imagekit.io/start.webp', {}, async (url, options) => {
    requested.push({ url: String(url), redirect: options.redirect });
    return new Response(null, { status: 302, headers: { location: 'https://attacker.example/pixel.webp' } });
  });

  assert.equal(result.error, 'unauthorised-redirect-host');
  assert.deepEqual(requested, [{ url: 'https://ik.imagekit.io/start.webp', redirect: 'manual' }]);
});

test('authorised same-host redirects are followed and bounded', async () => {
  const requested = [];
  const result = await fetchAuthorisedTarget('https://ik.imagekit.io/start.webp', {}, async (url, options) => {
    requested.push({ url: String(url), redirect: options.redirect });
    if (requested.length === 1) {
      return new Response(null, { status: 302, headers: { location: '/final.webp' } });
    }
    return new Response('image', { status: 200, headers: { 'content-type': 'image/webp' } });
  });

  assert.equal(result.error, null);
  assert.equal(result.finalUrl, 'https://ik.imagekit.io/final.webp');
  assert.equal(result.response.status, 200);
  assert.equal(requested.length, 2);
  assert.ok(requested.every((item) => item.redirect === 'manual'));
});

test('redirect loops stop at the configured hop limit', async () => {
  let requests = 0;
  const result = await fetchAuthorisedTarget('https://ik.imagekit.io/loop.webp', {}, async () => {
    requests += 1;
    return new Response(null, { status: 302, headers: { location: '/loop.webp' } });
  });

  assert.equal(result.error, 'too-many-redirects');
  assert.equal(requests, 6);
});
