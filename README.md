# Image Redirect Service (IRS)

IRS is the Cloudflare Pages registry behind `images.jonathan-harris.online`. It provides stable branded paths that permanently redirect to governed ImageKit assets.

## Production contract

- **Runtime:** Cloudflare Pages
- **Published directory:** `public`
- **Health:** `GET /health.json`
- **Redirect rules:** `public/_redirects`
- **Canonical registry:** `data/image-url-map.json`
- **Allowed destination hosts:** `config/allowed-destination-hosts.json`

Every redirect must use a unique path, an HTTPS destination and a permanent `301`, with the same mapping represented in the JSON registry. Validation rejects drift between the two sources and rejects destinations outside the governed host list.

## Local verification

```bash
npm ci --ignore-scripts
npm run verify
# Required before a production release; includes live reachability of all targets.
npm run verify:release
```

`npm run audit:targets` checks configured redirect destinations. CI runs it as part of `verify:release` before the exact-SHA release gate and retains the resulting JSON report for 90 days. `npm run watch:pages` provides deployment monitoring used by the operations workflow.

## Change workflow

1. Update `data/image-url-map.json` and `public/_redirects` together.
2. Run `npm run verify` while editing, then `npm run verify:release` before release.
3. Use the normal pull-request/CI path; CI independently re-probes every governed destination before the exact-SHA release gate.
4. After deployment, check `/health.json` and representative redirects; the deployment watcher and scheduled audit remain the second line of defence.

See `docs/deployment-guide.md`, `docs/OPERATIONAL_ALERTING.md` and `SECURITY.md`.
