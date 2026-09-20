> **Document status:** Production reference  
> **Last reviewed:** 20 September 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# Security policy

## Supported release

The current `main` branch and latest governed Cloudflare Pages deployment are supported.

## Security posture

IRS performs no server-side application processing in the request path. Production controls focus on redirect integrity, HTTPS-only fixed targets, deterministic builds, restrictive response headers, bounded external probes and preventing unreviewed configuration drift.

Repository validation rejects unauthorised destination hosts, embedded URL credentials, dynamic wildcard/placeholder redirect sources and redirects back to the production IRS host. Live target auditing follows remote redirects but accepts a result only when the final URL remains HTTPS on an authorised host and returns a valid image payload.

Generated compact audit status contains counts and timestamps only. It must not contain credentials, destination URLs or response bodies. Detailed target reports are retained as CI evidence and operational events are deliberately redacted.

Report suspected redirect hijacking, malicious targets or repository compromise privately to the repository owner. Do not publish credentials or exploit details in a public issue.

## Redirect trust-boundary review

Changes to `config/allowed-destination-hosts.json` alter the service's external trust boundary and require security-focused review before merge. The reviewer must confirm that every newly authorised host is owned or deliberately trusted, HTTPS-only and required by the redirect registry. The existing validation suite remains a merge gate for all registry and allow-list changes.

## Workflow permissions and secrets

Read-only permissions are the default for verification and scheduled target-audit workflows. The scheduled audit requires `actions: read` only to retrieve the previous compact status artifact. It does not write generated status back to the repository.

Operational webhook and Cloudflare API credentials are supplied through GitHub Actions secrets. Scripts do not print secret values or response bodies. Keep these credentials scoped to the minimum actions documented in the operations guide.
## Committed-secret prevention

`npm run scan:secrets` is the authoritative repository secret gate and is also executed by `npm run verify` in CI. The repository-local scanner detects high-confidence private-key, GitHub-token, AWS access-key, bearer/JWT, webhook, embedded URL-credential and password/API-token/secret assignment patterns. Scanner findings never print the complete credential value.

Synthetic fixtures and pre-existing security test vectors may be excepted only through `config/secret-scan-allowlist.json`. Each entry must identify one repository-relative file, one detector and the exact SHA-256 fingerprint of the synthetic value, with a documented reason. Stale allow-list entries fail the scan. Broad directory exclusions and real credential exceptions are not permitted.

The scanner intentionally skips only `.git`, installed `node_modules` and binary files. Generated test/audit output is not broadly exempted. No real secret should ever be committed, even temporarily.

