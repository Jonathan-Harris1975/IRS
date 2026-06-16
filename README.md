> **Document status:** Production reference  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# Image Redirect Service (IRS)

IRS is the production Cloudflare Pages registry behind `images.jonathan-harris.online`. It provides stable branded paths that redirect permanently to governed ImageKit assets.

## Production contract

- **Runtime:** Cloudflare Pages
- **Build command:** `npm ci --ignore-scripts && npm run verify`
- **Build output:** `public`
- **Health:** `GET /health.json`
- **Redirect source:** `public/_redirects`
- **Canonical registry:** `data/image-url-map.json`

Every redirect must have a unique path, an HTTPS destination, a permanent `301` status and an identical entry in the JSON registry. CI rejects drift between the two representations.

## Local verification

```bash
npm ci --ignore-scripts
npm run verify
```

## Release procedure

1. Update `data/image-url-map.json` and `public/_redirects` together.
2. Run the full verification command.
3. Open a pull request and wait for CI.
4. Merge to `main`; Cloudflare Pages deploys the validated `public` directory.
5. Probe `/health.json` and several representative redirects.

Operational detail is in [`docs/deployment-guide.md`](docs/deployment-guide.md). Security reporting is covered by [`SECURITY.md`](SECURITY.md).
