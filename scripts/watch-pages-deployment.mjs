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

if (!accountId || !projectName || !token || !/^[0-9a-f]{40}$/i.test(commitSha)) {
  console.error('Cloudflare Pages deployment watcher requires credentials and a full expected commit SHA.');
  process.exit(1);
}

function deploymentSha(item) {
  return item?.deployment_trigger?.metadata?.commit_hash || item?.source?.config?.commit_hash || '';
}

function deploymentBranch(item) {
  return String(item?.deployment_trigger?.metadata?.branch
    || item?.source?.config?.production_branch
    || item?.source?.config?.branch || '').trim();
}

function stageStatus(item) {
  return String(item?.latest_stage?.status || item?.stages?.at?.(-1)?.status || '').toLowerCase();
}

async function listDeployments() {
  const all = [];
  const seen = new Set();
  // Cloudflare lists are paginated. A stale first page must not certify a release.
  for (let page = 1; page <= 20; page += 1) {
    const endpoint = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${encodeURIComponent(projectName)}/deployments`);
    endpoint.searchParams.set('page', String(page));
    endpoint.searchParams.set('per_page', '100');
    const response = await fetch(endpoint, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Cloudflare Pages API returned HTTP ${response.status}`);
    const body = await response.json();
    if (!body?.success || !Array.isArray(body.result)) throw new Error('Cloudflare Pages API returned an invalid deployment list');
    for (const item of body.result) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      all.push(item);
    }
    const totalPages = Number(body.result_info?.total_pages);
    if (Number.isInteger(totalPages) && totalPages > 20) throw new Error('Cloudflare deployment history exceeds bounded pagination limit');
    if (Number.isInteger(totalPages) && totalPages > 0 ? page >= totalPages : body.result.length < 100) return all;
  }
  throw new Error('Cloudflare deployment pagination limit reached without exhausting history');
}

let last = null;
for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  const deployments = await listDeployments();
  const production = deployments.filter((item) => item.environment === 'production' && deploymentBranch(item) === 'main')
    .sort((a, b) => Date.parse(b.created_on || b.created_at || 0) - Date.parse(a.created_on || a.created_at || 0));
  const requested = commitSha ? commitSha.trim().toLowerCase() : '';
  const exactMatches = production.filter((item) => {
    const deployed = deploymentSha(item).trim().toLowerCase();
    // A shortened or mismatched hash is not sufficient production-release evidence.
    return /^[0-9a-f]{40}$/.test(deployed) && /^[0-9a-f]{40}$/.test(requested) && deployed === requested;
  });
  // Order by deployment creation time rather than relying on API list order.
  // A previously successful deployment must never attest a newer production release.
  // Only the latest production deployment can establish current deployed identity.
  const newestProduction = production[0] || null;
  last = newestProduction && exactMatches.some((item) => item.id === newestProduction.id)
    ? newestProduction : null;
  if (newestProduction && !last) {
    const newestSha = deploymentSha(newestProduction);
    console.log(`Latest production deployment SHA ${newestSha || 'missing'} does not match expected SHA; waiting for exact release.`);
  }
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
