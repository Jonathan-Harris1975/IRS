const MAX_PAGES = 20;
const PER_PAGE = 20;
const SHA = /^[a-f0-9]{40}$/i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function watchConfiguration(env) {
  const read = (name) => String(env[name] || '').trim();
  if (!read('CF_ACCOUNT_ID') || !read('CF_PAGES_PROJECT_NAME') || !read('CF_PAGES_API_TOKEN') || !SHA.test(read('GITHUB_SHA'))) {
    throw new Error('Cloudflare Pages deployment watcher requires credentials and a full expected commit SHA.');
  }
  const integer = (name, fallback, min, max) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
    return value;
  };
  return {
    accountId: read('CF_ACCOUNT_ID'), projectName: read('CF_PAGES_PROJECT_NAME'), token: read('CF_PAGES_API_TOKEN'),
    commitSha: read('GITHUB_SHA').toLowerCase(),
    maxAttempts: integer('CF_DEPLOYMENT_MAX_ATTEMPTS', 40, 1, 70),
    pollMs: integer('CF_DEPLOYMENT_POLL_MS', 15000, 5000, 30000),
    budgetMs: integer('CF_DEPLOYMENT_BUDGET_MS', 1080000, 1000, 1080000),
  };
}

export async function listDeployments(config, deps = {}) {
  const now = deps.now || Date.now;
  const wait = deps.sleep || sleep;
  const deadline = deps.deadline ?? now() + config.budgetMs;
  const records = new Map();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}`
      + `/pages/projects/${encodeURIComponent(config.projectName)}/deployments`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', String(PER_PAGE));
    url.searchParams.set('env', 'production');
    let body;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error('Cloudflare watch deadline exceeded');
      let delay = 1000 * 2 ** attempt;
      try {
        const response = await (deps.fetch || fetch)(url, {
          headers: { authorization: `Bearer ${config.token}`, accept: 'application/json' },
          redirect: 'error', signal: AbortSignal.timeout(Math.min(15000, remaining)),
        });
        if (!response.ok) {
          await response.body?.cancel();
          const error = new Error(`Cloudflare Pages API returned HTTP ${response.status}`);
          error.retryable = response.status === 429 || response.status >= 500;
          const value = response.headers.get('retry-after');
          const retryMs = value && Number.isFinite(Number(value)) ? Number(value) * 1000 : Date.parse(value || '') - now();
          if (Number.isFinite(retryMs)) delay = Math.max(delay, Math.min(30000, Math.max(0, retryMs)));
          throw error;
        }
        body = await response.json();
        if (body?.success !== true || !Array.isArray(body.result)) throw new Error('Invalid Cloudflare deployment list');
        break;
      } catch (error) {
        const retryable = error.retryable || ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name);
        if (!retryable || attempt === 2) {
          // Never include provider bodies or arbitrary transport diagnostics in retained evidence.
          throw new Error(/^Cloudflare Pages API returned HTTP/.test(error.message)
            ? error.message : `Cloudflare request failed: ${error.name}`);
        }
        if (now() + delay >= deadline) throw new Error('Cloudflare watch deadline exceeded');
        await wait(delay);
      }
    }
    const info = body.result_info;
    if (info?.page !== undefined && info.page !== page) throw new Error('Cloudflare returned a wrong or repeated page');
    const total = info?.total_pages;
    if (total !== undefined && (!Number.isInteger(total) || total < 0)) throw new Error('Invalid pagination metadata');
    if (total > MAX_PAGES) throw new Error('Cloudflare deployment history exceeds bounded pagination limit');
    for (const item of body.result) {
      if (!item || typeof item.id !== 'string' || !item.id) throw new Error('Invalid deployment identity');
      if (records.has(item.id) && JSON.stringify(records.get(item.id)) !== JSON.stringify(item)) throw new Error('Conflicting deployment identity');
      records.set(item.id, item);
    }
    const complete = total !== undefined ? page >= total : body.result.length < PER_PAGE;
    if (complete) return [...records.values()];
  }
  throw new Error('Cloudflare deployment pagination limit reached without exhausting history');
}

export function selectDeployment(deployments, config) {
  const production = deployments.filter((item) => item.environment === 'production');
  for (const item of production) {
    if (item.project_name !== config.projectName || !item.deployment_trigger?.metadata?.branch || !Number.isFinite(Date.parse(item.created_on))) {
      throw new Error('Production deployment has missing or mismatched identity metadata');
    }
  }
  production.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
  const newest = production[0];
  if (!newest) return null;
  if (production[1] && Date.parse(production[1].created_on) === Date.parse(newest.created_on)) throw new Error('Ambiguous newest production deployment');
  const metadata = newest.deployment_trigger.metadata;
  return metadata.branch === 'main' && typeof metadata.commit_hash === 'string' && SHA.test(metadata.commit_hash)
    && metadata.commit_hash.toLowerCase() === config.commitSha ? newest : null;
}

export async function watchDeployment(config, deps = {}) {
  const now = deps.now || Date.now;
  const wait = deps.sleep || sleep;
  const deadline = now() + config.budgetMs;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    const item = selectDeployment(await listDeployments(config, { ...deps, deadline }), config);
    const stage = item?.latest_stage;
    if (item && (item.is_skipped || ['failure', 'failed', 'error', 'cancelled', 'canceled', 'skipped'].includes(stage?.status))) {
      return { status: 'failed', deploymentId: item.id, stage: stage?.name, lastStatus: stage?.status, attempts: attempt };
    }
    if (item && stage?.name === 'deploy' && stage.status === 'success') {
      return { status: 'success', deploymentId: item.id, stage: stage.name, lastStatus: stage.status, attempts: attempt };
    }
    if (attempt === config.maxAttempts || now() + config.pollMs >= deadline) break;
    await wait(config.pollMs);
  }
  return { status: 'timeout', deploymentId: null };
}
