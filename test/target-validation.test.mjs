import assert from 'node:assert/strict';
import test from 'node:test';
import { declaredLength, isAuthorisedUrl, isImageContentType, looksLikeImage } from '../scripts/check-targets.mjs';

test('final target URL must remain HTTPS on the authorised host', () => {
  assert.equal(isAuthorisedUrl('https://ik.imagekit.io/7lx48g355/example.webp'), true);
  assert.equal(isAuthorisedUrl('http://ik.imagekit.io/7lx48g355/example.webp'), false);
  assert.equal(isAuthorisedUrl('https://example.com/example.webp'), false);
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
