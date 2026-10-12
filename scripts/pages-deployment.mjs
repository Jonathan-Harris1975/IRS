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
  const now = deps.now || Date.now;
  const deadline = deps.deadline ?? now() + config.budgetMs;
  const runs = [];
  const runIds = new Set();
  let expectedTotal;

  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(API_ROOT + '/repos/' + config.repository + '/commits/' + config.commitSha + '/check-runs');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const remaining = deadline - now();
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
    if (!Number.isInteger(body?.total_count) || body.total_count < 0 ||
        !Array.isArray(body.check_runs) || body.check_runs.length > 100) {
      throw new Error('GitHub checks API returned incomplete or invalid check-run data');
    }
    if (expectedTotal === undefined) expectedTotal = body.total_count;
    if (body.total_count !== expectedTotal || runs.length + body.check_runs.length > expectedTotal) {
      throw new Error('GitHub checks API returned inconsistent paginated check-run data');
    }
    for (const run of body.check_runs) {
      if (!Number.isSafeInteger(run?.id) || run.id <= 0 || runIds.has(run.id)) {
        throw new Error('GitHub checks API returned duplicate or invalid check-run identity');
      }
      runIds.add(run.id);
      runs.push(run);
    }
    if (runs.length === expectedTotal) {
      return runs.filter((run) => run?.name === config.checkName && run?.app?.slug === config.appSlug);
    }
    if (body.check_runs.length === 0 || page === 10) {
      throw new Error('GitHub checks API did not return all check-run pages');
    }
  }
  throw new Error('GitHub checks API exceeded the safe 1,000-check-run limit');
}

export function selectDeploymentCheck(checkRuns, config) {
  const matches = checkRuns.filter((run) => run?.name === config.checkName && run?.app?.slug === config.appSlug);
  // Fail closed if any exact-name/app result has malformed identity metadata.
  // Check Run objects expose started_at (not created_at). Queued checks may not
  // have started yet, so keep them pending instead of rejecting their metadata.
  for (const run of matches) {
    const startedAt = run.started_at == null ? null : Date.parse(run.started_at);
    if (run.head_sha?.toLowerCase() !== config.commitSha || !Number.isSafeInteger(run.id) || run.id <= 0 ||
        !['queued', 'in_progress', 'completed'].includes(run.status) ||
        (startedAt === null && run.status !== 'queued') ||
        (startedAt !== null && !Number.isFinite(startedAt))) {
      throw new Error('Cloudflare Pages check has invalid or mismatched identity metadata');
    }
  }
  const queued = matches.filter((run) => run.status === 'queued' && run.started_at == null);
  if (queued.length) {
    queued.sort((a, b) => b.id - a.id);
    const newestQueued = queued[0];
    const detailsUrl = newestQueued.details_url || newestQueued.html_url || null;
    return { state: 'pending', checkRunId: newestQueued.id, detailsUrl, startedAt: null };
  }
  matches.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  const newest = matches[0];
  if (!newest) return null;
  if (matches[1] && Date.parse(matches[1].started_at) === Date.parse(newest.started_at)) {
    throw new Error('Ambiguous newest Cloudflare Pages check');
  }
  const detailsUrl = newest.details_url || newest.html_url || null;  if (detailsUrl) {
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
    return { state: 'pending', checkRunId: newest.id, detailsUrl, startedAt: newest.started_at };
  }
  if (newest.conclusion === 'success') {
    return { state: 'success', checkRunId: newest.id, detailsUrl, startedAt: newest.started_at };
  }
  if (typeof newest.conclusion !== 'string' || !newest.conclusion) {
    throw new Error('Completed Cloudflare Pages check has no conclusion');
  }
  return {
    state: 'failed',
    checkRunId: newest.id,
    detailsUrl,
    startedAt: newest.started_at,
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
      const retryable = error.retryable === true ||
        ['TimeoutError', 'AbortError'].includes(error.name) ||
        ['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH',
          'ETIMEDOUT', 'ECONNABORTED', 'UND_ERR_CONNECT_TIMEOUT',
          'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'].includes(error.cause?.code || error.code);
      if (!retryable) throw error;
      if (attempt === config.maxAttempts || now() + config.pollMs >= deadline) break;
      await wait(config.pollMs);
      continue;
    }
    const selected = selectDeploymentCheck(checks, config);
    if (selected?.state === 'success') {
      return { status: 'success', checkRunId: selected.checkRunId, detailsUrl: selected.detailsUrl, startedAt: selected.startedAt, attempts: attempt };
    }
    if (selected?.state === 'failed') {
      return { status: 'failed', checkRunId: selected.checkRunId, detailsUrl: selected.detailsUrl, startedAt: selected.startedAt, conclusion: selected.conclusion, attempts: attempt };
    }
    if (attempt === config.maxAttempts || now() + config.pollMs >= deadline) break;
    await wait(config.pollMs);
  }
  return { status: 'timeout', checkRunId: null };
}
