# IRS controlled live-test readiness ledger

Baseline: `Jonathan-Harris1975/IRS`, main commit `24cf3443f9b7d09ceed95a4ad3d5a1f3574f728f`, inspected 2026-10-10 20:54 UTC. Revalidate HEAD before any approval.

**Verdict: NOT READY.** This ledger distinguishes code inspection from executed evidence. Never treat skipped checks or an absent provider response as success.

| Requirement | Status | Implementation / evidence | Reproduce | Remaining dependency / owner |
| --- | --- | --- | --- | --- |
| Exact-SHA Cloudflare Pages production attestation | verified on assessed SHA | Run 38085551178 for main SHA `24cf3443f9b7d09ceed95a4ad3d5a1f3574f728f` completed the Pages watcher, live target audit, and exact-SHA release gate successfully | https://github.com/Jonathan-Harris1975/IRS/actions/runs/38085551178 | Repeat after each release and retain the attestation; IRS operator |
| Pages pagination, 429, API failure, timeout, stale success regression | implemented and CI-verified | `scripts/pages-deployment.mjs` paginates up to 20 pages, bounds transient retries/deadlines, and fails closed on stale/wrong-SHA data; `test/pages-pagination-contract.test.mjs` covers these cases | `npm test`; deterministic repository verification passed in run 38085490529: https://github.com/Jonathan-Harris1975/IRS/actions/runs/38085490529 | Repeat unit verification after code changes; live provider fault injection remains unperformed |
| Redirect URL validation and target audit | main-branch gap; PR #119 pending | Current main follows redirects before checking the final host. PR #119 adds per-hop HTTPS/allowlist checks and bounded redirects with fixture tests; it is open and unmerged | `npm run check && npm test`; PR checks: https://github.com/Jonathan-Harris1975/IRS/pull/119 | Merge only through required checks/review; then run non-production redirect-chain test |
| Safe autonomous repair and bounded incident handling | blocked | `.github/workflows/autonomous-repair.yml` requires independent inspection | Inspect workflows and execute non-production fault injection | Safe repair PR, approvals, deduplication and escalation evidence; IRS maintainer |
| Credentialed deployment watcher dispatch | blocked; PR #118 pending | Main currently permits manual dispatch to run the Cloudflare watcher; PR #118 removes that entry point so only successful same-repository main production verification can invoke the secret-bearing job | Review https://github.com/Jonathan-Harris1975/IRS/pull/118 and its required checks | Merge after review, then verify automatic main-run path; IRS maintainer |
| OIDC cross-repository dispatch | payload fix merged; live dispatch unverified | PR #110 merged and main now sends the supported `{"ref":"main"}` payload to MAST `oidc-readiness.yml`. The IRS watch run completed its dispatch step, but available job summary does not distinguish actual dispatch from the guarded missing-token skip | https://github.com/Jonathan-Harris1975/IRS/pull/110 ; https://github.com/Jonathan-Harris1975/IRS/actions/runs/38085551178 | Confirm dispatch token/workflow configuration without exposing credentials, then correlate a MAST OIDC run to the IRS source SHA; IRS/MAST owners |
| Security and release gates | partly verified | PR #117 merged cryptographic GitHub OIDC signature/claim verification; run 38085490529 passed deterministic checks and exact-SHA release gating | https://github.com/Jonathan-Harris1975/IRS/pull/117 ; https://github.com/Jonathan-Harris1975/IRS/actions/runs/38085490529 | Cloud provider trust policy, effective branch rules, and live post-merge deployment/recovery still require external verification |
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
| 2026-10-10 20:54 | 24cf3443f9b7d09ceed95a4ad3d5a1f3574f728f | Pages production watcher + live redirect audit + exact-SHA release gate | https://github.com/Jonathan-Harris1975/IRS/actions/runs/38085551178 | Passed on inspected main SHA; cross-repository dispatch outcome not visible in summary | IRS/MAST owners |
| 2026-10-10 | 24cf3443f9b7d09ceed95a4ad3d5a1f3574f728f | Deterministic repository verification / fixture tests | https://github.com/Jonathan-Harris1975/IRS/actions/runs/38085490529 | Passed | IRS maintainer |
| 2026-10-11 | PR heads | Credentialed workflow entrypoint and redirect-hop hardening | PRs #118 and #119 | Open, unmerged; pending required checks and review | IRS maintainer |

Update every blocked row only after attaching observed proof. Live autonomous recovery is a separate milestone.
