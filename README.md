# Image Redirect Service (IRS)

IRS is the Cloudflare Pages redirect registry behind `images.jonathan-harris.online`. It gives published content stable branded image paths while the underlying assets live on explicitly authorised ImageKit hosts.

## Redirect model

IRS is a static service. Cloudflare Pages publishes `public/`; there is no application server or database in the request path.

- **Redirect rules:** `public/_redirects`
- **Canonical registry:** `data/image-url-map.json`
- **Allowed destination hosts:** `config/allowed-destination-hosts.json`
- **Static liveness:** `GET /health.json`
- **Runtime:** Cloudflare Pages

Every redirect is an exact source path with a fixed HTTPS destination and permanent `301` status. The JSON registry and `_redirects` file must contain the same mappings. Validation rejects duplicate sources, dynamic wildcard/placeholder sources, non-HTTPS destinations, embedded URL credentials, unauthorised destination hosts, production-host loops and registry drift.

The current rules do not use wildcard or placeholder path propagation. Fixed query strings already present on ImageKit destination URLs are part of the governed target. IRS does not use request query parameters as redirect match conditions.

## Health, redirect validity and dependency health

These are deliberately separate signals:

1. **Static/site liveness:** `/health.json` confirms that the static IRS deployment is being served. It is intentionally not coupled to downstream ImageKit availability.
2. **Redirect-rule validity:** `npm run verify` checks local structure, parity, source uniqueness, target scheme/host restrictions, redirect status and the static health contract.
3. **External target health:** `npm run audit:targets` performs bounded live probes of every authorised destination and verifies the final host, HTTP result, image MIME type, non-empty payload and recognised image signature.
4. **Audit freshness:** each live audit writes `reports/irs-target-status.json`. The scheduled workflow persists that document in the stable GitHub Actions artifact named `irs-target-status` and emits the same completion/failure timing data to the configured operations webhook.

A successful target result is not indefinitely green. The status document includes `staleness.staleAfter`; monitoring must treat the signal as **stale at or after that timestamp**, regardless of the stored successful result. The scheduled audit uses a 36-hour threshold, providing margin around a daily schedule without allowing a stopped workflow to look healthy forever.

## Monitoring and alerting

The `IRS scheduled target audit` workflow runs **daily at 06:17 UTC** and also supports manual dispatch. Deployment-related target validation remains in the production verification and Cloudflare Pages deployment-watch workflows.

Scheduled audits use:

- four concurrent target probes;
- a 12-second timeout per target request;
- a 20-minute workflow timeout;
- workflow concurrency control so scheduled/manual runs do not execute simultaneously;
- a 36-hour freshness threshold;
- 90-day retention for the compact status artifact and detailed audit report.

The compact status signal contains the last completed audit, last successful audit, success/failure result, targets checked, targets failing and the timestamp at which the observation becomes stale. It deliberately contains no credentials or destination URLs.

When `OPS_ALERT_WEBHOOK_URL` and `OPS_ALERT_WEBHOOK_TOKEN` are configured, every completed audit emits an operations heartbeat. Failed target audits emit a critical event and make the workflow fail. Operators should alert on either a failing audit or absence of a new heartbeat/status update by `staleAfter`.

For triage and status retrieval, see [`docs/OPERATIONAL_ALERTING.md`](docs/OPERATIONAL_ALERTING.md).

## Development and verification

Use the pinned Node/npm versions from `package.json` in CI and release work.

```bash
npm ci --ignore-scripts
npm run scan:secrets
npm run verify
```

`npm run scan:secrets` runs the repository-local committed-secret scanner. It checks text files for private-key blocks, GitHub-style tokens, AWS access-key IDs, bearer/JWT credentials, credential-bearing webhook URLs, embedded URL credentials and high-confidence password/API-token/secret assignments. Findings are reported with the credential value redacted.

The scanner uses `config/secret-scan-allowlist.json` only for exact synthetic/test vectors. Each exception is bound to the repository-relative path, detector type and SHA-256 fingerprint of the synthetic value, and stale exceptions fail the scan. Do not allow-list real credentials or broad directories.

`npm run verify` is deterministic and does not require live downstream availability. It includes the committed-secret gate, linting, redirect validation and the complete test suite.

Before a production release, also run the live target audit:

```bash
npm run verify:release
```

The live audit report is written to `reports/irs-target-audit.json`; the compact dependency/freshness signal is written to `reports/irs-target-status.json`. Reports are generated evidence and are not part of the static `/health.json` contract.

## Change and deployment workflow

1. Update `data/image-url-map.json` and `public/_redirects` together.
2. Add a destination host to `config/allowed-destination-hosts.json` only after ownership/trust and HTTPS behaviour are reviewed.
3. Run `npm run verify` while editing; this includes the committed-secret gate.
4. Run `npm run verify:release` before production release.
5. Use the normal pull-request/CI route. CI independently re-probes every governed destination before the exact-SHA release gate.
6. Cloudflare Pages publishes `public/` from `main` after the configured production checks.
7. After deployment, confirm `/health.json`, representative redirects, the deployment watcher and the latest target-audit status.

Rollback and post-deployment checks are documented in [`docs/deployment-guide.md`](docs/deployment-guide.md). Security controls and the redirect trust boundary are documented in [`SECURITY.md`](SECURITY.md).
