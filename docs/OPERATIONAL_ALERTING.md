# IRS operations and alerting

**Status:** Cloudflare Pages production  
**Last reviewed:** 22 September 2026

IRS uses `data/image-url-map.json` and `public/_redirects` as a parity-checked redirect registry. `config/allowed-destination-hosts.json` is the authoritative destination-domain allow-list. CI rejects unknown hosts, embedded URL credentials, dynamic redirect sources and production-host loops before deployment.

## Health model

Do not collapse these signals into one status:

| Signal | Source | Meaning |
|---|---|---|
| Static liveness | `/health.json` | The static IRS deployment is available and satisfies its basic health contract. |
| Redirect validity | `npm run verify` / CI | Repository redirect structure and policy are valid. |
| External dependency health | `npm run audit:targets` | Authorised destination assets currently pass live validation. |
| Audit freshness | `irs-target-status` artifact / operations heartbeat | The most recent external audit is recent enough to trust. |

A downstream target outage must not make `/health.json` report the static site as dead. Conversely, a green `/health.json` must never be interpreted as proof that every redirect destination is healthy.

## Scheduled target audit

`IRS scheduled target audit` runs every day at **06:17 UTC** and supports `workflow_dispatch` for manual execution. The production verification and Pages deployment-watch workflows continue to perform deployment-related target validation.

Scheduled probes use a 12-second per-request timeout and a maximum concurrency of four. The workflow has a 20-minute overall timeout and a concurrency group that prevents overlapping scheduled/manual runs. This keeps detection latency close to one day without creating an unnecessary burst against the downstream image host.

A completed audit writes:

- `reports/irs-target-audit.json`: detailed per-target evidence, retained as `irs-target-audit-<run_id>` for 90 days;
- `reports/irs-target-status.json`: compact operational status, retained under the stable artifact name `irs-target-status` for 90 days.

The scheduled workflow restores the previous compact status when available so a failed audit preserves the timestamp of the last successful audit.

## Target-status contract

`reports/irs-target-status.json` has this operational shape:

```json
{
  "schemaVersion": 1,
  "service": "IRS",
  "check": "redirect-target-audit",
  "result": "success",
  "lastCompletedAt": "2026-09-20T06:17:00.000Z",
  "lastSuccessfulAt": "2026-09-20T06:17:00.000Z",
  "targetsChecked": 103,
  "targetsFailing": 0,
  "staleness": {
    "thresholdHours": 36,
    "staleAfter": "2026-09-21T18:17:00.000Z",
    "statusAtGeneration": "fresh",
    "rule": "Treat the signal as stale when the observation time is at or after staleAfter."
  }
}
```

The compact document contains no destination URLs, response bodies, credentials or secret values.

### Freshness rule

A monitor must evaluate current time against `staleness.staleAfter` on every observation. `statusAtGeneration` only records the state when the file was written; it is not a perpetual assertion of freshness.

Operational state is therefore:

- **failing** if `result` is `failure`;
- **stale** if `result` is `success` but current time is at or after `staleAfter`;
- **healthy** only if `result` is `success` and current time is before `staleAfter`;
- **unknown/unhealthy** if the status artifact or heartbeat cannot be retrieved after the expected retention/access checks.

The 36-hour threshold gives the daily job reasonable scheduling tolerance while still exposing a missed audit well before the old weekly detection window.

## Retrieving the persisted status

For GitHub-based monitoring, retrieve the newest non-expired artifact named `irs-target-status` through the GitHub Actions Artifacts API, download it, and evaluate `reports/irs-target-status.json`. The scheduled workflow uses that same mechanism to restore the previous `lastSuccessfulAt` value without committing generated monitoring data back to `main`.

For an operator using GitHub CLI:

```bash
gh api "repos/OWNER/REPOSITORY/actions/artifacts?name=irs-target-status&per_page=100"
```

Select the newest non-expired artifact, download its `archive_download_url`, then evaluate the contained JSON against the freshness rule above. Private repositories require normal authenticated GitHub access; public exposure of the compact signal is not required for the status contract.

## Operations heartbeat and alerts

When both operations webhook secrets are configured, every completed live target audit emits one of these redacted events:

- `redirect_target_audit_completed` with informational severity when all targets pass;
- `broken_redirect_targets` with critical severity when one or more targets fail.

Event details contain counts and audit/freshness timestamps, not destination URLs or response bodies. Monitoring should treat the event stream as a heartbeat and alert when no new audit event is observed by the latest `staleAfter` timestamp.

A target failure also causes the scheduled GitHub Actions job to fail after the status/report artifacts and job summary have been published.

## Triage procedure

1. Read the latest job summary and compact `irs-target-status` artifact.
2. If `result=failure`, open the matching detailed `irs-target-audit-<run_id>` report and identify affected source paths and failure reasons.
3. Confirm whether the final host remains authorised and whether the asset was moved, removed, replaced with non-image content or is temporarily unavailable.
4. Do not change `/health.json` to failed solely because of a downstream outage.
5. Correct the governed target mapping or downstream asset, run `npm run verify`, then run `npm run audit:targets` or manually dispatch the scheduled workflow.
6. Confirm the next compact status reports success and has a new `lastSuccessfulAt` and `staleAfter`.

## Cloudflare Pages deployment watcher

After successful production verification on `main`, the watcher polls GitHub Checks for the exact source SHA. It accepts only the newest `Cloudflare Pages` check from the `cloudflare-workers-and-pages` GitHub App. A pending check is polled for a bounded 17.5 minutes; failure, timeout, missing evidence, ambiguous results, wrong SHA, or an unexpected app blocks the attestation and emits a critical operations event.

The workflow needs only the automatically provided `GITHUB_TOKEN` with `checks:read` and `contents:read`. Cloudflare account ID, project name, and API token secrets are no longer required in GitHub Actions. The Cloudflare Pages project must be connected to this repository through the Cloudflare GitHub App, scoped to IRS, with `main` as the production branch. Do not merge this watcher change until that provider check is visible for an IRS commit.

The provider check proves the Cloudflare deployment reached the expected commit. The separate live redirect-target audit still verifies the authorised destinations, and both gates must pass before the exact-SHA attestation is retained. Run `npm test` for credential-free workflow contract checks.



## Authoritative change procedure

1. Add or change the redirect in both registry representations.
2. Add a new destination host to the allow-list only after ownership and HTTPS behaviour are reviewed.
3. Run `npm run verify`; this includes the dedicated committed-secret scanner and deterministic redirect/test gates.
4. Run `npm run audit:targets` for a live destination check.
5. Merge through normal CI and confirm the Cloudflare deployment event in operations monitoring.
6. Confirm a fresh compact target-audit status exists after deployment/scheduled validation.

## Rollback

Select the previous successful Cloudflare Pages deployment or revert the registry commit. Never patch redirects only in the dashboard, because that creates unreviewed drift.
