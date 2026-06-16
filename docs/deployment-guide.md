# IRS production deployment guide

**Status:** Production-controlled  
**Last reviewed:** 16 June 2026

## Cloudflare Pages settings

| Setting | Value |
|---|---|
| Production branch | `main` |
| Build command | `npm ci --ignore-scripts && npm run verify` |
| Build output directory | `public` |
| Custom domain | `images.jonathan-harris.online` |

No runtime secrets are required. The service is static and its deployable state is fully represented by the repository.

## Validation and rollback

Before deployment, CI validates registry parity, unique source paths, HTTPS destinations, permanent redirect codes and the health contract. After deployment, check `https://images.jonathan-harris.online/health.json` and a sample of branded URLs.

To roll back, select the previous successful Cloudflare Pages deployment or revert the offending commit. Do not edit production redirects solely in the Cloudflare dashboard, because that would create configuration drift.
