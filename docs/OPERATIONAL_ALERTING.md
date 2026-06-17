# IRS professional operations and alerting

**Status:** Cloudflare Pages production  
**Last reviewed:** 17 June 2026

IRS uses `data/image-url-map.json` and `public/_redirects` as a parity-checked redirect registry. `config/allowed-destination-hosts.json` is the authoritative destination-domain allow-list. CI rejects unknown hosts before deployment.

## Scheduled target audit

The weekly `IRS scheduled target audit` workflow probes every authorised destination with bounded concurrency and timeout. It retains `reports/irs-target-audit.json` as a GitHub artifact for 90 days and sends a redacted HIVE event when targets fail. Run it manually after large registry changes.

## Cloudflare Pages deployment watcher

After a successful production verification on `main`, the watcher queries the Cloudflare Pages deployments API and follows the matching production deployment. It alerts HIVE on failure or timeout. Required GitHub secrets:

- `CF_ACCOUNT_ID`
- `CF_PAGES_PROJECT_NAME`
- `CF_PAGES_API_TOKEN`, scoped for Pages deployment read access
- `OPS_ALERT_WEBHOOK_URL`
- `OPS_ALERT_WEBHOOK_TOKEN`

## Authoritative change procedure

1. Add or change the redirect in both registry representations.
2. Add a new destination host to the allow-list only after ownership and HTTPS behaviour are reviewed.
3. Run `npm run verify`.
4. Run `npm run audit:targets` for a live destination check.
5. Merge to `main` and confirm the Cloudflare deployment event in HIVE-UI Ops.

## Rollback

Select the previous successful Cloudflare Pages deployment or revert the registry commit. Never patch redirects only in the dashboard, because that creates unreviewed drift.
