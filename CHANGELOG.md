> **Document status:** Production reference  
> **Last reviewed:** 20 September 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# Changelog

## Unreleased — 20 September 2026

- Replaced the narrow CI secret grep with a repository-local, redacting secret scanner covering private keys, GitHub/AWS tokens, bearer/JWT credentials, webhook/URL credentials and high-confidence credential assignments.
- Added exact fingerprint-based synthetic/test-vector allow-listing plus deterministic scanner tests for detection, redaction, safe placeholders, narrow exceptions and whole-repository cleanliness.
- Reconciled README, security, deployment and operations documentation with the dedicated scanner and local/CI execution path.
- Increased external redirect-target auditing from weekly to daily at 06:17 UTC while preserving manual and deployment-related validation.
- Added scheduled-workflow concurrency controls plus explicit bounded target concurrency and request/workflow timeouts.
- Added a compact persistent target-audit status artifact with last-completed, last-successful, result, checked/failing counts and a 36-hour staleness rule.
- Added operations heartbeat events for successful live audits and retained critical events for failures.
- Added status-schema, staleness and workflow-contract tests while keeping static `/health.json` independent from downstream dependency health.
- Hardened redirect validation against dynamic user-controlled source patterns, embedded destination credentials and production-host redirect loops.
- Reconciled README, deployment, operations and security documentation with the current redirect, health, monitoring and recovery model.

## 1.0.0 — 16 June 2026

- Added a deterministic redirect-registry validator and contract tests.
- Added a production health document and Cloudflare security headers.
- Added GitHub Actions verification and secret scanning.
- Reworked deployment, security and operational documentation.
