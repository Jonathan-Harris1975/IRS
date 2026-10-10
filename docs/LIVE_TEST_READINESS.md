# IRS controlled live-test readiness ledger

Baseline: `Jonathan-Harris1975/IRS`, main commit `3bd3d4fde6cdb26ca1074544670887ad45f01045`, inspected 2026-10-10 UTC. Revalidate HEAD before any approval.

**Verdict: NOT READY.** This ledger distinguishes code inspection from executed evidence. Never treat skipped checks or an absent provider response as success.

| Requirement | Status | Implementation / evidence | Reproduce | Remaining dependency / owner |
| --- | --- | --- | --- | --- |
| Exact-SHA Cloudflare Pages production attestation | blocked | `scripts/watch-pages-deployment.mjs`; `.github/workflows/pages-deployment-watch.yml`; checks newest main production SHA | `npm run watch:pages` with scoped Cloudflare credentials and expected SHA | Cloudflare deployment/run URL and witnessed result; IRS operator |
| Pages pagination, 429, API failure, timeout, stale success regression | blocked | `scripts/watch-pages-deployment.mjs`; inspected watcher currently requests a single deployment page | `npm test`; add fixture tests before approval | Pagination and bounded retry implementation/tests; IRS maintainer |
| Redirect URL validation and target audit | blocked | `scripts/check-targets.mjs`; follows redirects then checks final host, so intermediary requests require separate SSRF/redirect-hop review | `npm run check && npm run audit:targets` | Full malicious redirect chain rehearsal and external outage classification; IRS maintainer |
| Safe autonomous repair and bounded incident handling | blocked | `.github/workflows/autonomous-repair.yml` requires independent inspection | Inspect workflows and execute non-production fault injection | Safe repair PR, approvals, deduplication and escalation evidence; IRS maintainer |
| OIDC cross-repository dispatch | blocked | `.github/workflows/pages-deployment-watch.yml` sends undeclared inputs; PR #110 proposes fix | Review https://github.com/Jonathan-Harris1975/IRS/pull/110 and run CI | Merge after required checks; configure scoped dispatch token and workflow variable; IRS/MAST owners |
| Security and release gates | blocked | `.github/workflows/oidc-readiness.yml` validates selected OIDC claims | `npm run verify`; inspect latest CI/security run URLs | Current-HEAD workflow conclusions, credential trust and branch rules; IRS owner |
| Staging rehearsal, rollback and kill switch | blocked | No witnessed rehearsal attached to this ledger | Follow controlled test matrix below | Approved execution plan, deployment rollback and abort evidence; release owner |
| Eight-repository evidence contract | blocked | Cross-repo contract not attested here | Verify each repo's endpoint, OIDC audience, artifact digest, SHA and escalation | AIMS, AIMS-UI, HIVE, HIVE-UI, IRS, MAST, RAMS, website owners |

## Safe controlled live-test runbook

1. Record current default-branch SHA, protected-branch rules, open PRs, latest 30 relevant runs, staging endpoint, Cloudflare project/environment and authorised operators. Attach immutable links to this ledger.
2. Run `npm run verify` and applicable security, integration and build checks at that SHA. Record commands, exit codes and actual workflow URLs. Stop on any mandatory failure or skip.
3. Confirm scoped credentials/OIDC audience, exact SHA, production route, alert recipient, rate limits and operator-approved rollback. Do not print secrets.
4. In **non-production only**, inject (a) an invalid redirect rule and (b) a failed Pages deployment. Verify classification, deduplication, bounded retries, a non-merging repair PR, CI/security checks, escalation and audit artefacts.
5. Exercise API 429, timeout, unavailable Cloudflare, stale success, cancelled deployment, wrong SHA, redirect loop, disallowed hop, malformed URL, fork PR and concurrent incidents with mocks. Stop if any safety boundary fails.
6. Obtain explicit approval before any live change. Abort on wrong SHA, unexpected route/DNS mutation, alert delivery failure, uncontrolled retries, bypassed review, or any P0/P1 issue.
7. Roll back using the pre-approved Cloudflare deployment/route procedure, then independently confirm endpoint health and the restored exact SHA. Record the operator, timestamp, deployment ID and evidence URL.

## Evidence log

| Timestamp UTC | Commit SHA | Check / scenario | Run URL | Outcome | Owner |
| --- | --- | --- | --- | --- | --- |
| 2026-10-10 | 3bd3d4fde6cdb26ca1074544670887ad45f01045 | Repository inspection; no live dispatch performed | not available | blocked | IRS maintainer |

Update every blocked row only after attaching observed proof. Live autonomous recovery is a separate milestone.
