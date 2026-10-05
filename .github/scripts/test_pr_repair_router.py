"""Focused tests for autonomous PR repair routing; network access is mocked."""

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("GITHUB_REPOSITORY", "owner/repo")
os.environ.setdefault("GH_TOKEN", "test-token")
os.environ.setdefault("GITHUB_EVENT_NAME", "pull_request_review_comment")
os.environ.setdefault("DEFAULT_BRANCH", "main")
sys.path.insert(0, str(Path(__file__).parent))
import pr_repair_router as m


class Router(unittest.TestCase):
    def setUp(self):
        self.pr = {
            "number": 7,
            "html_url": "https://github.com/owner/repo/pull/7",
            "state": "open",
            "draft": False,
            "labels": [],
            "user": {"login": "owner"},
            "head": {"sha": "a" * 40, "ref": "ci/test", "repo": {"full_name": "owner/repo"}},
            "base": {"ref": "main"},
        }

    def test_review_evidence_strips_manual_fix_prompt(self):
        body = "Fix the missing validation in security.yml.\n\nReply with `@kilocode-bot fix it` to have Kilo Code address this issue."
        evidence = m.review_evidence(body, ".github/workflows/security.yml")
        self.assertIn("missing validation", evidence)
        self.assertNotIn("@kilocode-bot", evidence)

    def test_untrusted_review_comment_is_ignored(self):
        event = {"pull_request": {"number": 7}, "comment": {"user": {"login": "outsider"}, "body": "Fix security.yml because validation is missing."}}
        with patch.object(m, "EVENT", "pull_request_review_comment"):
            self.assertIsNone(m.extract(event))

    def test_kilo_review_comment_routes_verified_pr(self):
        event = {"pull_request": {"number": 7}, "comment": {"user": {"login": "kilo-code-bot"}, "body": "Fix security.yml because validation is missing."}}
        with patch.object(m, "EVENT", "pull_request_review_comment"), patch.object(m, "pr_details", return_value=self.pr):
            result = m.extract(event)
        self.assertEqual(result[1], "review")
        self.assertIn("security.yml", result[2][0])

    def test_safe_route_error_redacts_unknown_details(self):
        self.assertEqual(m.safe_route_error(RuntimeError("secret endpoint detail")), "RuntimeError; detail withheld")

    def test_safe_route_error_reports_webhook_status(self):
        self.assertEqual(m.safe_route_error(RuntimeError("Kilo trigger returned HTTP 403")), "Kilo trigger returned HTTP 403")


if __name__ == "__main__":
    unittest.main()
