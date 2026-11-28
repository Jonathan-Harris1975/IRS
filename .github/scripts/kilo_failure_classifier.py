#!/usr/bin/env python3
"""Route deterministic repository failures, not infrastructure or account failures."""
from __future__ import annotations

import re
import sys

# A step name is evidence of the operation that failed, not proof of root cause.
# The repair agent must reproduce the defect before modifying code.
ACTIONABLE_CHECK = re.compile(
    r"\b(test|pytest|vitest|jest|unit|integration|type(?:check)?|mypy|pyright|"
    r"build|compile|import|module|lint|format|prettier|eslint|ruff|schema|migration|"
    r"lock(?:file)?|dependency|dependencies|audit|vulnerab\w*|codeql|trivy|gitleaks|"
    r"security|actionlint|zizmor|container image|toolchain)\b", re.I)
# These operations are handled by the existing operational/autofix lanes.
PLUMBING = re.compile(
    r"\b(autofix|checkout|cache|artifact|runner|wait|attestation|scorecard)\b|"
    r"\b(?:set up|setup|upload|download|install)\b", re.I)
EXTERNAL = re.compile(
    r"\b(account|billing|quota|rate.limit|credential|permissions?|token|"
    r"authentication|authorization)\b|"
    r"\b(?:mint|configure|load|fetch|rotate|retrieve|validate)\b.*\b(?:secret|api key)\b",
    re.I)
# Provider operations alone do not imply a code defect. Named tests, builds and
# integration checks can be repaired even when their job refers to a provider.
PROVIDER = re.compile(r"\b(deploy|deployment|koyeb|cloudflare|pages|worker)\b", re.I)
DETERMINISTIC = re.compile(
    r"\b(test|pytest|vitest|jest|unit|integration|build|compile|type(?:check)?|"
    r"mypy|pyright|lint|eslint|ruff|toolchain|schema|lock(?:file)?|actionlint)\b", re.I)


def is_repairable(step: str) -> bool:
    if EXTERNAL.search(step) or PLUMBING.search(step):
        return False
    if PROVIDER.search(step) and (
        not DETERMINISTIC.search(step) or re.search(r"\b(?:smoke|live|readiness|health)\b", step, re.I)
    ):
        return False
    return bool(ACTIONABLE_CHECK.search(step))


def repairable_failed_steps(steps: list[str]) -> list[str]:
    return [step for step in steps if is_repairable(step)]


def main() -> int:
    steps = [line.strip() for line in sys.stdin if line.strip()]
    actionable = repairable_failed_steps(steps)
    if not actionable:
        print("No repository-repairable failed step identified; Kilo will not be triggered.")
        return 3
    for step in actionable[:12]:
        print(step)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
