const SHA = /^[a-f0-9]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CHECK_NAME = 'Cloudflare Pages';
const APP_SLUG = 'cloudflare-workers-and-pages';
const API_ROOT = 'https://api.github.com';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function watchConfiguration(env) {
  const read = (name) => String(env[name] || '').trim();
  if (!read('GITHUB_TOKEN') || !REPOSITORY.test(read('GITHUB_REPOSITORY')) || !SHA.test(read('GITHUB_SHA'))) {
    throw new Error('Cloudflare Pages watcher requires a GitHub token, repository and full expected commit SHA.');
  }
  const integer = (name, fallback, min, max) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid ' + name);
    return value;
  };
  return {
    token: read('GITHUB_TOKEN'),
    repository: read('GITHUB_REPOSITORY'),
    commitSha: read('GITHUB_SHA').toLowerCase(),
    checkName: CHECK_NAME,
    appSlug: APP_SLUG,
    maxAttempts: integer('CF_DEPLOYMENT_MAX_ATTEMPTS', 40, 1, 70),
    pollMs: integer('CF_DEPLOYMENT_POLL_MS', 15000, 5000, 30000),
    budgetMs: integer('CF_DEPLOYMENT_BUDGET_MS', 1080000, 1000, 1080000),
  };
}

export async function listDeploymentChecks(config, deps = {}) {
  const url = new URL(API_ROOT + '/repos/' + config.repository + '/commits/' + config.commitSha + '/check-runs');
  url.searchParams.set('per_page', '100');
  const now = deps.now || Date.now;
  const remaining = (deps.deadline ?? now() + config.budgetMs) - now();
  if (remaining <= 0) throw new Error('GitHub deployment check deadline exceeded');
  const response = await (deps.fetch || fetch)(url, {
    headers: {
      authorization: 'Bearer ' + config.token,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'IRS-Cloudflare-Pages-readiness',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(Math.min(15000, remaining)),
  });
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error('GitHub checks API returned HTTP ' + response.status);
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  let body;
  try { body = await response.json(); } catch {
    throw new Error('GitHub checks API returned invalid JSON');
  }
  if (!Number.isInteger(body?.total_count) || !Array.isArray(body.check_runs) ||
      body.total_count !== body.check_runs.length || body.total_count > 100) {
    throw new Error('GitHub checks API returned incomplete or invalid check-run data');
  }
  return body.check_runs.filter((run) => run?.name === config.checkName && run?.app?.slug === config.appSlug);
}

export function selectDeploymentCheck(checkRuns, config) {
  const matches = checkRuns.filter((run) => run?.name === config.checkName && run?.app?.slug === config.appSlug);
  for (const run of matches) {
    if (run.head_sha?.toLowerCase() !== config.commitSha || !Number.isSafeInteger(run.id) || run.id <= 0 ||
        !Number.isFinite(Date.parse(run.created_at)) || !['queued', 'in_progress', 'completed'].includes(run.status)) {
      throw new Error('Cloudflare Pages check has invalid or mismatched identity metadata');
    }
  }
  matches.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const newest = matches[0];
  if (!newest) return null;
  if (matches[1] && Date.parse(matches[1].created_at) === Date.parse(newest.created_at)) {
    throw new Error('Ambiguous newest Cloudflare Pages check');
  }
  const detailsUrl = newest.details_url || newest.html_url || null;
  if (detailsUrl) {
    let parsed;
    try { parsed = new URL(detailsUrl); } catch {
      throw new Error('Cloudflare Pages check has an invalid details URL');
    }
    if (parsed.protocol !== 'https:' ||
        !['dash.cloudflare.com', 'github.com'].includes(parsed.hostname)) {
      throw new Error('Cloudflare Pages check has an untrusted details URL');
    }
  }
  if (newest.status !== 'completed') {
    return { state: 'pending', checkRunId: newest.id, detailsUrl, createdAt: newest.created_at };
  }
  if (newest.conclusion === 'success') {
    return { state: 'success', checkRunId: newest.id, detailsUrl, createdAt: newest.created_at };
  }
  if (typeof newest.conclusion !== 'string' || !newest.conclusion) {
    throw new Error('Completed Cloudflare Pages check has no conclusion');
  }
  return {
    state: 'failed',
    checkRunId: newest.id,
    detailsUrl,
    createdAt: newest.created_at,
    conclusion: newest.conclusion,
  };
}

export async function watchDeployment(config, deps = {}) {
  const now = deps.now || Date.now;
  const wait = deps.sleep || sleep;
  const deadline = now() + config.budgetMs;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    let checks;
    try {
      checks = await listDeploymentChecks(config, { ...deps, deadline });
    } catch (error) {
      const retryable = error.retryable || ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name);
      if (!retryable) throw error;
      if (attempt === config.maxAttempts || now() + config.pollMs >= deadline) break;
      await wait(config.pollMs);
      continue;
    }
    const selected = selectDeploymentCheck(checks, config);
    if (selected?.state === 'success') {
      return { status: 'success', checkRunId: selected.checkRunId, detailsUrl: selected.detailsUrl, createdAt: selected.createdAt, attempts: attempt };
    }
    if (selected?.state === 'failed') {
      return { status: 'failed', checkRunId: selected.checkRunId, detailsUrl: selected.detailsUrl, createdAt: selected.createdAt, conclusion: selected.conclusion, attempts: attempt };
    }
    if (attempt === config.maxAttempts || now() + config.pollMs >= deadline) break;
    await wait(config.pollMs);
  }
  return { status: 'timeout', checkRunId: null };
}
