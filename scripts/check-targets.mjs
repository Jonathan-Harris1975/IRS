import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { sendOpsEvent } from './send-ops-event.mjs';

const root = process.cwd();
const registry = JSON.parse(fs.readFileSync(path.join(root, 'data', 'image-url-map.json'), 'utf8'));
const outputPath = path.resolve(process.env.IRS_TARGET_REPORT_PATH || path.join(root, 'reports', 'irs-target-audit.json'));
const timeoutMs = Math.max(1000, Number(process.env.IRS_TARGET_TIMEOUT_MS || 12000));
const concurrency = Math.max(1, Math.min(12, Number(process.env.IRS_TARGET_CONCURRENCY || 6)));

async function probe(source, target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    let response = await fetch(target, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
    if ([403, 405].includes(response.status)) {
      response = await fetch(target, { method: 'GET', redirect: 'follow', headers: { range: 'bytes=0-0' }, signal: controller.signal });
    }
    return {
      source,
      target,
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      finalUrl: response.url,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return { source, target, ok: false, status: null, error: error?.name || 'Error', latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

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
    summary: `${failures.length} of ${results.length} authorised redirect targets could not be reached.`,
    release_id: process.env.GITHUB_SHA || null,
    url: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    details: { failed: failures.length, checked: results.length, sources: failures.slice(0, 10).map((item) => item.source) },
  });
  process.exitCode = 1;
}
