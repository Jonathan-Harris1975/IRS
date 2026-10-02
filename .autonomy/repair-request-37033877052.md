# Autonomous repair request

- Failed workflow: Security and repository quality
- Failed commit: ff051e9d6ce2a077b560a93d06d220f177de79ac
- Failed run: https://github.com/Jonathan-Harris1975/IRS/actions/runs/37033877052
- Run ID: 37033877052
- Security-classified workflow: true

Fix the smallest code, dependency-manifest, lockfile, build or deployment-configuration defect that caused this failure.
Delete this file only after the underlying defect is fixed and the relevant repository checks pass.

Guardrails:
- Do not weaken tests, CodeQL, Trivy, Gitleaks, required checks, branch/ruleset protections, workflow permissions, secret handling or security policy.
- Do not dismiss CodeQL alerts, reduce query coverage, add broad suppressions or change secret allowlists merely to make CI green.
- Do not merge or deploy directly.
- If credentials, destructive data changes, platform administration, alert dismissal or a security-policy decision are required, keep this marker and use autonomy:human-hold.
