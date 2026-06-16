> **Document status:** Production reference  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# Security policy

## Supported release

The current `main` branch and the latest Cloudflare Pages deployment are supported.

## Security posture

IRS contains no credentials and performs no server-side processing. Production controls focus on redirect integrity, HTTPS-only targets, deterministic builds, restrictive response headers and preventing unreviewed configuration drift.

Report suspected redirect hijacking, malicious targets or repository compromise privately to the repository owner. Do not publish credentials or exploit details in a public issue.
