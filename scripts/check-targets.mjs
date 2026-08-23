import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { sendOpsEvent } from './send-ops-event.mjs';

const root = process.cwd();
const registry = JSON.parse(fs.readFileSync(path.join(root, 'data', 'image-url-map.json'), 'utf8'));
const allowedHostConfig = JSON.parse(fs.readFileSync(path.join(root, 'config', 'allowed-destination-hosts.json'), 'utf8'));
const allowedHosts = new Set(Array.isArray(allowedHostConfig?.hosts) ? allowedHostConfig.hosts : []);
const outputPath = path.resolve(process.env.IRS_TARGET_REPORT_PATH || path.join(root, 'reports', 'irs-target-audit.json'));
const timeoutMs = Math.max(1000, Number(process.env.IRS_TARGET_TIMEOUT_MS || 12000));
const concurrency = Math.max(1, Math.min(12, Number(process.env.IRS_TARGET_CONCURRENCY || 6)));
const signatureBytes = Math.max(32, Math.min(4096, Number(process.env.IRS_TARGET_SIGNATURE_BYTES || 512)));

if (!allowedHosts.size) {
  throw new Error('config/allowed-destination-hosts.json must contain at least one approved host');
}

function isAuthorisedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && allowedHosts.has(url.hostname);
  } catch {
    return false;
  }
}

function isImageContentType(value) {
  return /^image\/[a-z0-9.+-]+(?:\s*;|$)/i.test(String(value || '').trim());
}

function declaredLength(response) {
  const contentRange = response.headers.get('content-range');
  const rangeMatch = contentRange?.match(/\/(\d+)$/);
  if (rangeMatch) return Number(rangeMatch[1]);
  const rawContentLength = response.headers.get('content-length');
  if (!rawContentLength) return null;
  const contentLength = Number(rawContentLength);
  return Number.isFinite(contentLength) ? contentLength : null;
}

function looksLikeImage(bytes, contentType) {
  if (!bytes?.length) return false;
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return true;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b.length >= 6) {
    const gif = Buffer.from(b.subarray(0, 6)).toString('ascii');
    if (gif === 'GIF87a' || gif === 'GIF89a') return true;
  }
  if (b.length >= 12) {
    const riff = Buffer.from(b.subarray(0, 4)).toString('ascii');
    const webp = Buffer.from(b.subarray(8, 12)).toString('ascii');
    if (riff === 'RIFF' && webp === 'WEBP') return true;
    const box = Buffer.from(b.subarray(4, 12)).toString('ascii');
    if (/ftyp(?:avif|avis|heic|heix|mif1)/.test(box)) return true;
  }
  if (/image\/svg\+xml/i.test(contentType || '')) {
    const prefix = Buffer.from(b.subarray(0, Math.min(b.length, 512))).toString('utf8').replace(/^\uFEFF/, '').trimStart();
    return /^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(prefix);
  }
  return false;
}

async function readPrefix(response) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < signatureBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.length) continue;
      const take = Math.min(value.length, signatureBytes - total);
      chunks.push(value.subarray(0, take));
      total += take;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

async function probe(source, target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,image/*;q=0.8,*/*;q=0.1',
        Range: `bytes=0-${signatureBytes - 1}`,
      },
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    const contentLength = declaredLength(response);
    const prefix = response.ok || response.status === 206 ? await readPrefix(response) : new Uint8Array();
    const finalHostAuthorised = isAuthorisedUrl(response.url);
    const imageContentType = isImageContentType(contentType);
    const nonEmpty = contentLength === null ? prefix.length > 0 : contentLength > 0;
    const validSignature = looksLikeImage(prefix, contentType);
    const ok = (response.ok || response.status === 206)
      && finalHostAuthorised
      && imageContentType
      && nonEmpty
      && validSignature;

    return {
      source,
      target,
      ok,
      status: response.status,
      finalUrl: response.url,
      finalHostAuthorised,
      contentType,
      contentLength,
      signatureBytesRead: prefix.length,
      validSignature,
      latencyMs: Date.now() - startedAt,
      ...(ok ? {} : {
        reason: !finalHostAuthorised ? 'unauthorised-final-host'
          : !imageContentType ? 'non-image-content-type'
            : !nonEmpty ? 'empty-image-payload'
              : !validSignature ? 'invalid-image-signature'
                : `http-${response.status}`,
      }),
    };
  } catch (error) {
    return { source, target, ok: false, status: null, error: error?.name || 'Error', latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const entries = Object.entries(registry);
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const index = cursor++;
      const [source, target] = entries[index];
      results[index] = await probe(source, target);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const failures = results.filter((item) => !item.ok);
  const report = {
    service: 'IRS',
    generatedAt: new Date().toISOString(),
    checked: results.length,
    healthy: results.length - failures.length,
    failed: failures.length,
    requirements: {
      authorisedFinalHost: true,
      imageContentType: true,
      nonEmptyPayload: true,
      recognisedImageSignature: true,
    },
    failures,
    results,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`IRS target audit checked ${report.checked} targets: ${report.healthy} healthy, ${report.failed} failed.`);
  if (failures.length) {
    await sendOpsEvent({
      event_id: `irs:target-audit:${process.env.GITHUB_RUN_ID || report.generatedAt}`,
      severity: 'critical',
      event_type: 'broken_redirect_targets',
      title: 'IRS redirect target audit failed',
      summary: `${failures.length} of ${results.length} authorised redirect targets failed HTTP, host, MIME, payload or image-signature validation.`,
      release_id: process.env.GITHUB_SHA || null,
      url: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
      details: {
        failed: failures.length,
        checked: results.length,
        failures: failures.slice(0, 10).map((item) => ({ source: item.source, reason: item.reason || item.error || 'unknown' })),
      },
    });
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}

export { declaredLength, isAuthorisedUrl, isImageContentType, looksLikeImage };
