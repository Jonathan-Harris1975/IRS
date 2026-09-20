# IRS production deployment guide

**Status:** Production-controlled  
**Last reviewed:** 20 September 2026

## Cloudflare Pages settings

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | `npm ci --ignore-scripts && npm run verify` |
| Build output directory | `public` |
| Custom domain | `images.jonathan-harris.online` |

IRS is a static Cloudflare Pages service. No runtime application secret is required to serve redirects. Deployment-watcher and operational-notification credentials exist only in GitHub Actions and are not part of the published `public/` directory.

## Pre-deployment validation

Run:

```bash
npm ci --ignore-scripts
npm run verify
npm run audit:targets
```

`npm run verify` validates registry parity, unique exact source paths, HTTPS-only destinations, the approved host allow-list, absence of embedded destination credentials, permanent `301` status, loop prevention and the static health contract.

`npm run audit:targets` is a separate live dependency check. It follows the destination response and verifies that the final URL remains on an authorised HTTPS host and returns a non-empty image payload with an image MIME type and recognised signature.

CI keeps these concerns separate: deterministic verification is required, and a live target audit gates non-pull-request releases. The exact-SHA release gate requires the applicable checks to pass.

## Deployment and post-deployment verification

Cloudflare Pages publishes `public/` from `main`. The Pages deployment watcher follows the production deployment matching the workflow SHA when Cloudflare API credentials are configured.

After deployment:

1. Confirm `https://images.jonathan-harris.online/health.json` returns the static healthy contract.
2. Check representative branded redirect paths and confirm a single permanent redirect to the intended authorised target.
3. Confirm the deployment-watch target audit completed and its report/status artifacts were retained.
4. Confirm the scheduled target-audit workflow remains enabled for the next daily 06:17 UTC run.
5. Confirm operations monitoring received the target-audit heartbeat when webhook credentials are configured.

A green `/health.json` proves static/site liveness only. Downstream target health comes from the live audit and its freshness signal.

## Scheduled dependency verification

The scheduled audit runs daily at 06:17 UTC, with manual dispatch available. It uses bounded concurrency (four), a 12-second per-request timeout, a 20-minute workflow timeout and a 36-hour staleness threshold.

Each scheduled run publishes:

- `irs-target-status`: compact persistent status/freshness artifact, 90-day retention;
- `irs-target-audit-<run_id>`: detailed audit evidence, 90-day retention;
- a GitHub Actions step summary with result, counts, completion time, last success and stale-after time.

The compact status is intentionally not committed into `public/` or `main`; this avoids deployment/commit loops and keeps static liveness independent from mutable dependency state. See [`OPERATIONAL_ALERTING.md`](OPERATIONAL_ALERTING.md) for retrieval and staleness semantics.

## Failure and recovery

If deterministic validation fails, do not deploy the registry change. Correct the mapping/configuration and rerun `npm run verify`.

If the live target audit fails, inspect the detailed report. Resolve the downstream asset or governed redirect target, then rerun `npm run audit:targets` or manually dispatch the scheduled workflow. The compact status preserves the previous `lastSuccessfulAt` across completed failures.

If audit status becomes stale, first confirm the scheduled workflow is enabled and GitHub Actions is running. A stale successful result is not healthy evidence; obtain a new completed live audit.

## Rollback

Select the previous successful Cloudflare Pages deployment or revert the offending registry commit. Do not edit production redirects solely in the Cloudflare dashboard, because that creates configuration drift outside the reviewed repository.
