import process from 'node:process';
import { sendOpsEvent } from './send-ops-event.mjs';

function env(name) {
  return String(process.env[name] || '').trim();
}

const accountId = env('CF_ACCOUNT_ID');
const projectName = env('CF_PAGES_PROJECT_NAME');
const token = env('CF_PAGES_API_TOKEN');
const commitSha = env('GITHUB_SHA');
const maxAttempts = Math.max(1, Number(process.env.CF_DEPLOYMENT_MAX_ATTEMPTS || 40));
const pollMs = Math.max(5000, Number(process.env.CF_DEPLOYMENT_POLL_MS || 15000));

if (!accountId || !projectName || !token) {
  console.log('Cloudflare Pages deployment watcher is not configured; skipping.');
  process.exit(0);
}

function deploymentSha(item) {
  return item?.deployment_trigger?.metadata?.commit_hash || item?.source?.config?.commit_hash || '';
}

function stageStatus(item) {
  return String(item?.latest_stage?.status || item?.stages?.at?.(-1)?.status || '').toLowerCase();
}

async function listDeployments() {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/deployments`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Cloudflare Pages API returned HTTP ${response.status}`);
  const body = await response.json();
  if (!body?.success || !Array.isArray(body.result)) throw new Error('Cloudflare Pages API returned an invalid deployment list');
  return body.result;
}

let last = null;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const deployments = await listDeployments();
  const production = deployments.filter((item) => item.environment === 'production');
  last = commitSha
    ? production.find((item) => deploymentSha(item).startsWith(commitSha)) || null
    : production[0] || null;
  if (!last) {
    console.log(`Expected IRS production deployment is not visible yet (attempt ${attempt}/${maxAttempts}).`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    continue;
  }
  const status = stageStatus(last);
  console.log(`IRS Cloudflare Pages deployment ${last.id}: ${status || 'unknown'} (attempt ${attempt}/${maxAttempts})`);
  if (status === 'success') process.exit(0);
  if (['failure', 'failed', 'error', 'cancelled'].includes(status)) {
    await sendOpsEvent({
      event_id: `cloudflare-pages:IRS:${last.id}`,
      severity: 'critical',
      event_type: 'deployment_failed',
      title: 'IRS Cloudflare Pages deployment failed',
      summary: `Production deployment ${last.id} finished with status ${status}.`,
      release_id: deploymentSha(last) || commitSha || null,
      url: last.url || null,
      details: { deploymentId: last.id, status, projectName },
    });
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}

await sendOpsEvent({
  event_id: `cloudflare-pages:IRS:timeout:${process.env.GITHUB_RUN_ID || Date.now()}`,
  severity: 'warning',
  event_type: 'deployment_watch_timeout',
  title: 'IRS deployment confirmation timed out',
  summary: 'The Cloudflare Pages deployment did not reach a terminal state within the watcher window.',
  release_id: commitSha || null,
  details: { deploymentId: last?.id || null, lastStatus: last ? stageStatus(last) : 'not-found', projectName },
});
process.exit(1);
