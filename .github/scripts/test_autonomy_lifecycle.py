"""Regression checks for repair retirement; all GitHub writes are mocked."""
import copy
import inspect
import json
from pathlib import Path
import os
import unittest
import native_auto_merge
import kilo_failure_classifier
from unittest.mock import patch

os.environ.setdefault("GH_TOKEN", "unit-test")
os.environ.setdefault("GITHUB_REPOSITORY", "owner/repo")

import branch_pr_automation as branch_controller  # noqa: E402
import trusted_automation as automation  # noqa: E402
import autonomy_admission_check as admission_check  # noqa: E402


class RoutineUnitTestRiskClassificationTests(unittest.TestCase):
    def test_regular_unit_tests_are_low_risk_but_security_tests_stay_high_risk(self):
        with patch.object(automation, "REPO", "Jonathan-Harris1975/AIMS"):
            self.assertFalse(automation.sensitive_file("tests/unit/test_routes.py"))
            self.assertFalse(automation.sensitive_file("test/widgets/widget.test.ts"))
            self.assertTrue(automation.sensitive_file("tests/security/test_policy.py"))
            self.assertTrue(automation.sensitive_file("tests/test_auth.py"))


class RepairRetirementTests(unittest.TestCase):
    def setUp(self):
        self.current = "a" * 40
        self.pr = {
            "number": 1,
            "state": "open",
            "title": "[autonomy] Repair CI failure (123)",
            "user": {"login": "repair[bot]"},
            "head": {"ref": "autonomy/repair-123", "repo": {"full_name": "owner/repo"}},
            "base": {"ref": "main"},
            "labels": [{"name": "autonomy:repair"}],
            "body": f"Failed commit: `{self.current}`",
        }
        for name, value in {"REPO": "owner/repo", "REPAIR_APP_LOGIN": "repair[bot]", "DEFAULT_BRANCH": "main"}.items():
            self.enterContext(patch.object(automation, name, value))
        self.enterContext(patch.object(automation, "get", return_value={"commit": {"sha": self.current}}))
        self.write = self.enterContext(patch.object(automation, "request"))
        self.labels = self.enterContext(patch.object(automation, "add_labels"))
        self.delete = self.enterContext(patch.object(automation, "delete"))
        self.enterContext(patch.object(automation, "log"))

    def retire(self):
        automation.reconcile_stale_carriers([copy.deepcopy(self.pr)])

    def test_current_unresolved_carrier_remains_open(self):
        self.retire()
        self.write.assert_not_called()

    def test_current_human_hold_remains_open(self):
        self.pr["labels"].append({"name": "autonomy:human-hold"})
        self.retire()
        self.write.assert_not_called()
        self.delete.assert_not_called()

    def test_obsolete_carrier_closes_even_at_current_sha(self):
        self.pr["labels"].append({"name": "autonomy:obsolete"})
        self.retire()
        self.write.assert_called_once_with("PATCH", "/repos/owner/repo/pulls/1", {"state": "closed"})
        self.delete.assert_called_once_with("/repos/owner/repo/issues/1/labels/autonomy%3Arepair", expected=(200, 204))

    def test_retirement_retries_after_active_label_was_removed(self):
        self.pr["labels"] = [{"name": "autonomy:superseded"}]
        self.retire()
        self.write.assert_called_once()

    def test_stale_carrier_is_labelled_and_closed(self):
        self.pr["body"] = f"Failed commit: `{'b' * 40}`"
        self.retire()
        self.labels.assert_called_once_with(1, ["autonomy:obsolete"])
        self.write.assert_called_once()

    def test_impostor_and_implementation_are_never_retired(self):
        self.pr["labels"].append({"name": "autonomy:obsolete"})
        self.pr["user"]["login"] = "another-user"
        self.retire()
        self.pr["user"]["login"] = "repair[bot]"
        self.pr["head"]["ref"] = "implementation/fix"
        self.retire()
        self.write.assert_not_called()

    def test_fork_carrier_is_never_retired(self):
        self.pr["labels"].append({"name": "autonomy:obsolete"})
        self.pr["head"]["repo"]["full_name"] = "fork/repo"
        self.retire()
        self.write.assert_not_called()

    def test_failed_close_keeps_active_labels_for_retry(self):
        self.pr["labels"].append({"name": "autonomy:obsolete"})
        self.write.side_effect = RuntimeError("simulated unavailable API")
        with self.assertRaises(RuntimeError):
            self.retire()
        self.delete.assert_not_called()


class ExplicitRetirementTests(unittest.TestCase):
    def setUp(self):
        self.pr = {
            "number": 88, "state": "open", "draft": False,
            "user": {"login": "owner"},
            "head": {"ref": "work/stale", "repo": {"full_name": "owner/repo"}},
            "base": {"ref": "main"},
            "labels": [{"name": "autonomy:obsolete"}, {"name": "automation:branch-pr"}],
        }
        for name, value in {"REPO": "owner/repo", "DEFAULT_BRANCH": "main"}.items():
            self.enterContext(patch.object(automation, name, value))
        self.write = self.enterContext(patch.object(automation, "request"))
        self.delete = self.enterContext(patch.object(automation, "delete"))
        self.enterContext(patch.object(automation, "log"))

    def test_explicit_obsolete_label_closes_same_repo_pr(self):
        automation.reconcile_explicitly_retired_prs([copy.deepcopy(self.pr)])
        self.write.assert_called_once_with("PATCH", "/repos/owner/repo/pulls/88", {"state": "closed"})
        self.delete.assert_called_once_with(
            "/repos/owner/repo/issues/88/labels/automation%3Abranch-pr", expected=(200, 204)
        )

    def test_unlabelled_or_fork_pr_is_not_closed(self):
        unlabelled = copy.deepcopy(self.pr)
        unlabelled["labels"] = []
        fork = copy.deepcopy(self.pr)
        fork["head"]["repo"]["full_name"] = "fork/repo"
        automation.reconcile_explicitly_retired_prs([unlabelled, fork])
        self.write.assert_not_called()

class ManagedBranchOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.sha = "c" * 40
        self.pr = {
            "number": 22,
            "state": "open",
            "draft": False,
            "title": "Implement requested change",
            "user": {"login": "repair[bot]"},
            "head": {
                "ref": "codex/requested-change",
                "sha": self.sha,
                "repo": {"full_name": "owner/repo"},
            },
            "base": {"ref": "main"},
            "labels": [{"name": "automation:branch-pr"}],
            "body": "",
        }
        for name, value in {
            "REPO": "owner/repo",
            "REPAIR_APP_LOGIN": "repair[bot]",
            "DEFAULT_BRANCH": "main",
        }.items():
            self.enterContext(patch.object(automation, name, value))
        self.enterContext(patch.object(automation, "log"))

    def test_branch_controller_has_no_merge_authority(self):
        source = inspect.getsource(branch_controller)
        self.assertNotIn("enablePullRequestAutoMerge", source)
        self.assertNotIn("disablePullRequestAutoMerge", source)
        self.assertNotIn('gh", "pr", "merge', source)

    def test_managed_branch_pr_is_admitted_to_mergify_after_green_checks(self):
        admit = self.enterContext(patch.object(automation, "admit_to_mergify"))
        self.enterContext(
            patch.object(automation, "pr_files", return_value=["docs/runbook.md"])
        )
        self.enterContext(
            patch.object(
                automation,
                "all_required_checks_green",
                return_value=(True, "green"),
            )
        )
        self.enterContext(
            patch.object(automation, "current_head_unchanged", return_value=self.pr)
        )

        automation.reconcile_pr(copy.deepcopy(self.pr))

        admit.assert_called_once_with(22, self.sha)

    def test_managed_branch_pr_touching_governance_gets_human_hold(self):
        hold = self.enterContext(patch.object(automation, "require_operator_risk_approval", return_value=True))
        admit = self.enterContext(patch.object(automation, "admit_to_mergify"))
        self.enterContext(
            patch.object(
                automation,
                "pr_files",
                return_value=[".github/workflows/security.yml"],
            )
        )

        automation.reconcile_pr(copy.deepcopy(self.pr))

        hold.assert_called_once()
        admit.assert_not_called()


class KiloPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[2]
        cls.policy = json.loads((root / "kilo.jsonc").read_text(encoding="utf-8"))

    def test_non_interactive_repairs_cannot_self_amend_governance(self):
        permission = self.policy["permission"]
        self.assertEqual(permission["question"], "deny")
        self.assertEqual(permission["external_directory"], "deny")
        for tool in ("edit", "write", "apply_patch"):
            self.assertEqual(permission[tool]["*"], "allow")
            for path in ("kilo.jsonc", ".github/workflows/*", ".github/scripts/*", ".github/production-governance.json", ".mergify.yml", "renovate.json"):
                self.assertEqual(permission[tool][path], "deny")

    def test_shell_is_deny_by_default_and_cannot_merge_deploy_or_force_push(self):
        bash = self.policy["permission"]["bash"]
        self.assertEqual(bash["*"], "deny")
        for command in ("git push origin HEAD", "git push --set-upstream origin HEAD", "git push -u origin HEAD"):
            self.assertEqual(bash[command], "allow")
        for command in ("git push *:*", "git push +*", "git push --force", "git push -f",
                        "git push --force-with-lease", "git push --mirror", "git push --delete",
                        "gh pr merge *", "wrangler deploy *", "npx wrangler deploy *"):
            self.assertEqual(bash[command], "deny")


class RenovateGovernanceTests(unittest.TestCase):
    def test_auto_eligible_renovate_governance_change_gets_hold(self):
        pr = {
            "number": 77, "state": "open", "draft": False,
            "title": "Update action", "user": {"login": "renovate[bot]"},
            "head": {"ref": "renovate/action", "sha": "d" * 40, "repo": {"full_name": "owner/repo"}},
            "base": {"ref": "main"}, "labels": [{"name": "dependency:auto-eligible"}],
            "body": "This PR was generated by [Mend Renovate]\n<!--renovate-debug:test-->",
        }
        with (
            patch.object(automation, "REPO", "owner/repo"),
            patch.object(automation, "DEFAULT_BRANCH", "main"),
            patch.object(automation, "pr_files", return_value=[".github/workflows/security.yml"]),
            patch.object(automation, "require_operator_risk_approval", return_value=True) as hold,
            patch.object(automation, "admit_to_mergify") as admit,
        ):
            automation.reconcile_pr(pr)
        hold.assert_called_once()
        admit.assert_not_called()


class ProductionGovernanceProtectionTests(unittest.TestCase):
    def test_contract_is_sensitive_and_kilo_cannot_mutate_it(self):
        path = ".github/production-governance.json"
        self.assertTrue(automation.sensitive_file(path))
        root = Path(__file__).resolve().parents[2]
        policy = json.loads((root / "kilo.jsonc").read_text(encoding="utf-8"))
        for tool in ("edit", "write", "apply_patch"):
            self.assertEqual(policy["permission"][tool][path], "deny")



    def test_main_repair_reserves_marker_before_kilo_and_acknowledges_after(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / "workflows/autonomous-repair.yml").read_text(encoding="utf-8")
        self.assertIn(chr(10) + '            reservation_id="$(gh api --method POST', workflow)
        self.assertIn(chr(10) + '            status="$(curl', workflow)
        dispatch = workflow.split("dispatch_kilo() {", 1)[1].split("\n          }", 1)[0]
        reservation = dispatch.index("gh api --method POST")
        request = dispatch.index('status="$(curl')
        acknowledgement = dispatch.index("gh api --method PATCH")
        self.assertLess(reservation, request)
        self.assertLess(request, acknowledgement)
        self.assertIn('--field body="$marker', dispatch)
        self.assertIn("--jq '.id'", dispatch)
        self.assertIn("if ! gh api --method PATCH", dispatch)
        self.assertIn("dispatch-state: pending", dispatch)
        self.assertIn("dispatch-state: accepted", dispatch)
        self.assertIn("dispatch-state: rejected-http-$status", dispatch)
        self.assertIn('rejected_attempts" -ge 2', dispatch)

    def test_main_repair_classifies_failed_steps_before_creating_or_dispatching(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / "workflows/autonomous-repair.yml").read_text(encoding="utf-8")
        failure_gate = workflow.index('if [ "$RUN_CONCLUSION" != "failure" ]')
        failed_steps = workflow.index('failed_steps="$(gh api', failure_gate)
        classifier = workflow.index("python3 .github/scripts/kilo_failure_classifier.py", failed_steps)
        carrier_search = workflow.index('existing=""', classifier)
        self.assertLess(failure_gate, failed_steps)
        self.assertLess(failed_steps, classifier)
        self.assertLess(classifier, carrier_search)


class KiloFailureClassificationTests(unittest.TestCase):
    def test_only_repository_repairable_failed_steps_are_returned(self):
        steps = [
            "Run pytest",
            "Run deployment smoke test",
            "Run eslint lint",
            "Build production bundle",
            "Runner lost communication",
            "Run CodeQL security analysis",
        ]
        self.assertEqual(
            kilo_failure_classifier.repairable_failed_steps(steps),
            ["Run pytest", "Build production bundle", "Run CodeQL security analysis"],
        )

    def test_unknown_failure_is_not_repairable(self):
        self.assertEqual(
            kilo_failure_classifier.repairable_failed_steps(["External service unavailable"]),
            [],
        )



class TrustedAdmissionProofTests(unittest.TestCase):
    @patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"})
    @patch("autonomy_admission_check._request")
    def test_success_proof_is_created_for_exact_head(self, request):
        request.side_effect = [{"check_runs": []}, {"id": 1}, [], {}]
        sha = "a" * 40
        self.assertTrue(
            admission_check.set_admission_check(17, sha, "success", "verified")
        )
        method, path, payload = request.call_args_list[1].args
        self.assertEqual(method, "POST")
        self.assertEqual(path, "/repos/owner/repo/check-runs")
        self.assertEqual(payload["head_sha"], sha)
        self.assertEqual(payload["name"], "Trusted autonomy admission")
        self.assertEqual(payload["conclusion"], "success")
        status_get_method, status_get_path = request.call_args_list[2].args
        self.assertEqual(status_get_method, "GET")
        self.assertEqual(status_get_path, f"/repos/owner/repo/commits/{sha}/statuses?per_page=100")
        status_method, status_path, status_payload = request.call_args_list[3].args
        self.assertEqual(status_method, "POST")
        self.assertEqual(status_path, f"/repos/owner/repo/statuses/{sha}")
        self.assertEqual(status_payload["context"], "Trusted autonomy admission")
        self.assertEqual(status_payload["state"], "success")

    @patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"})
    @patch("autonomy_admission_check._request")
    def test_uppercase_head_sha_is_normalized_before_publication(self, request):
        request.side_effect = [{"check_runs": []}, {"id": 1}, [], {}]
        sha = "A" * 40
        self.assertTrue(
            admission_check.set_admission_check(20, sha, "success", "verified")
        )
        payload = request.call_args_list[1].args[2]
        self.assertEqual(payload["head_sha"], sha.lower())
        self.assertEqual(
            payload["external_id"],
            f"trusted-autonomy-admission:20:{sha.lower()}",
        )

    @patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"})
    @patch("autonomy_admission_check._request")
    def test_existing_check_is_updated_only_when_owned_by_actions(self, request):
        request.side_effect = [
            {"check_runs": [
                {"id": 11, "app": {"slug": "other-app"}, "started_at": "2026-01-01T00:00:00Z"},
                {"id": 12, "app": {"slug": "github-actions"}, "name": "Trusted autonomy admission", "head_sha": "b" * 40, "external_id": "trusted-autonomy-admission:18:" + "b" * 40, "started_at": "2026-01-02T00:00:00Z"},
            ]},
            {},
            [],
            {},
        ]
        sha = "b" * 40
        self.assertTrue(
            admission_check.set_admission_check(18, sha, "failure", "withheld")
        )
        method, path, payload = request.call_args_list[1].args
        self.assertEqual(method, "PATCH")
        self.assertEqual(path, "/repos/owner/repo/check-runs/12")
        self.assertEqual(payload["head_sha"], sha)
        self.assertEqual(payload["conclusion"], "failure")
        status_get_method, status_get_path = request.call_args_list[2].args
        self.assertEqual(status_get_method, "GET")
        self.assertEqual(status_get_path, f"/repos/owner/repo/commits/{sha}/statuses?per_page=100")
        status_method, status_path, status_payload = request.call_args_list[3].args
        self.assertEqual(status_method, "POST")
        self.assertEqual(status_path, f"/repos/owner/repo/statuses/{sha}")
        self.assertEqual(status_payload["context"], "Trusted autonomy admission")
        self.assertEqual(status_payload["state"], "failure")

    @patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"})
    @patch("autonomy_admission_check._request")
    def test_same_exact_pr_status_is_not_republished(self, request):
        request.side_effect = [
            {"check_runs": []},
            {"id": 1},
            [{
                "context": "Trusted autonomy admission",
                "target_url": "https://github.com/owner/repo/pull/17",
                "state": "success",
                "created_at": "2026-10-25T21:00:00Z",
                "creator": {"login": "github-actions[bot]"},
            }],
        ]
        self.assertTrue(admission_check.set_admission_check(17, "a" * 40, "success", "verified"))
        self.assertEqual(request.call_count, 3)

    @patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"})
    @patch("autonomy_admission_check._request")
    def test_unverified_pr_does_not_create_a_failure_check_unless_label_was_forged(self, request):
        request.return_value = {"check_runs": []}
        self.assertFalse(
            admission_check.set_admission_check(
                19, "c" * 40, "failure", "not eligible", create_if_missing=False
            )
        )
        self.assertEqual(request.call_count, 1)
        self.assertEqual(request.call_args.args[0], "GET")


class AdmissionLifecycleProofTests(unittest.TestCase):
    def test_label_alone_is_withdrawn_when_trusted_validation_did_not_admit(self):
        number = 201
        sha = "d" * 40
        pr = {"number": number, "head": {"sha": sha, "repo": {"full_name": "owner/repo"}}, "base": {"ref": "main"}, "labels": [{"name": "autonomy:admitted"}]}
        with (
            patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"}),
            patch.object(automation, "REPO", "owner/repo"),
            patch.object(automation, "_reconcile_pr_candidate"),
            patch.object(automation, "set_admission_check") as set_check,
            patch.object(automation, "remove_label") as remove_label,
        ):
            automation.reconcile_pr(pr)
        self.assertEqual(set_check.call_count, 2)
        self.assertEqual(set_check.call_args_list[0].args[:3], (number, sha, "failure"))
        args, kwargs = set_check.call_args
        self.assertEqual(args[:3], (number, sha, "failure"))
        self.assertTrue(kwargs["create_if_missing"])
        remove_label.assert_called_once_with(number, "autonomy:admitted")

    def test_only_successful_trusted_validation_keeps_admission(self):
        number = 202
        sha = "e" * 40
        pr = {"number": number, "head": {"sha": sha, "repo": {"full_name": "owner/repo"}}, "base": {"ref": "main"}, "labels": [{"name": "autonomy:admitted"}]}
        def verified(candidate):
            automation.VERIFIED_ADMISSION_HEADS.add((number, sha))
            automation.set_admission_check(number, sha, "success", "current trusted evidence passed")
        with (
            patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"}),
            patch.object(automation, "REPO", "owner/repo"),
            patch.object(automation, "_reconcile_pr_candidate", side_effect=verified),
            patch.object(automation, "set_admission_check") as set_check,
            patch.object(automation, "remove_label") as remove_label,
        ):
            automation.reconcile_pr(pr)
        self.assertEqual(set_check.call_count, 2)
        self.assertEqual(set_check.call_args_list[0].args[:3], (number, sha, "failure"))
        self.assertEqual(set_check.call_args_list[1].args[:3], (number, sha, "success"))
        remove_label.assert_not_called()


class OwnerCodexAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.sha = "f" * 40
        self.pr = {
            "number": 301,
            "state": "open",
            "draft": False,
            "user": {"login": "owner"},
            "head": {
                "ref": "codex/fix-low-risk",
                "sha": self.sha,
                "repo": {"full_name": "owner/repo"},
            },
            "base": {"ref": "main"},
            "labels": [],
            "body": "Verified routine task",
        }
        self.enterContext(patch.object(automation, "REPO", "owner/repo"))
        self.enterContext(patch.object(automation, "DEFAULT_BRANCH", "main"))
        self.enterContext(patch.object(automation, "REPAIR_APP_LOGIN", "repair[bot]"))

    def test_owner_authored_same_repo_codex_branch_is_recognized(self):
        self.assertTrue(automation.is_owner_codex_pr(self.pr))
        self.assertEqual(automation.automation_kind(self.pr), "codex")

    def test_fork_author_draft_and_non_codex_branches_are_not_eligible(self):
        for change in (
            {"head": {"ref": "codex/fix-low-risk", "sha": self.sha, "repo": {"full_name": "fork/repo"}}},
            {"user": {"login": "someone-else"}},
            {"head": {"ref": "feature/fix-low-risk", "sha": self.sha, "repo": {"full_name": "owner/repo"}}},
            {"draft": True},
        ):
            candidate = copy.deepcopy(self.pr)
            candidate.update(change)
            self.assertFalse(automation.is_owner_codex_pr(candidate))

    def test_sensitive_owner_codex_changes_are_held(self):
        with (
            patch.dict(os.environ, {"ADMISSION_TOKEN": "unit-test", "REPO": "owner/repo"}),
            patch.object(automation, "pr_files", return_value=[".github/workflows/ci.yml"]),
            patch.object(automation, "require_operator_risk_approval", return_value=True) as hold,
            patch.object(automation, "admit_to_mergify") as admit,
            patch.object(automation, "set_admission_check"),
            patch.object(automation, "remove_label"),
        ):
            automation.reconcile_pr(self.pr)
        hold.assert_called_once()
        admit.assert_not_called()




class AdmissionRetryDelayTests(unittest.TestCase):
    @patch("autonomy_admission_check.time.time", return_value=30)
    def test_retry_after_http_date_is_parsed(self, _now):
        self.assertEqual(
            admission_check._retry_delay(
                "Thu, 01 Jan 1970 00:00:45 GMT", None, None, 0
            ),
            15.0,
        )

    def test_delta_seconds_and_invalid_headers(self):
        self.assertEqual(admission_check._retry_delay("5", None, None, 0), 5.0)
        self.assertEqual(admission_check._retry_delay("invalid", None, None, 2), 4.0)

    @patch("autonomy_admission_check.time.time", return_value=30)
    def test_rate_limit_reset_is_bounded(self, _now):
        self.assertEqual(admission_check._retry_delay(None, "100", "0", 1), 30.0)



class NativeAutoMergeCurrentLabelTests(unittest.TestCase):
    def test_fresh_hold_label_blocks_auto_merge_enable(self):
        summary = {
            "number": 7,
            "labels": [{"name": "autonomy:admitted"}],
            "node_id": "PR_node_7",
        }
        detail = {
            "state": "open",
            "draft": False,
            "base": {"ref": "main"},
            "head": {"sha": "a" * 40},
            "mergeable": True,
            "labels": [
                {"name": "autonomy:admitted"},
                {"name": "autonomy:human-hold"},
            ],
        }
        with (
            patch.object(native_auto_merge, "merge_request", return_value=None),
            patch.object(native_auto_merge, "request", return_value=detail),
            patch.object(native_auto_merge, "admission_check", return_value=(True, True)),
            patch.object(native_auto_merge, "enable") as enable,
        ):
            native_auto_merge.reconcile(summary)
        enable.assert_not_called()

    def test_risk_approval_label_blocks_auto_merge_enable(self):
        summary = {
            "number": 7,
            "labels": [{"name": "autonomy:admitted"}],
            "node_id": "PR_node_7",
        }
        detail = {
            "state": "open",
            "draft": False,
            "base": {"ref": "main"},
            "head": {"sha": "a" * 40},
            "mergeable": True,
            "labels": [
                {"name": "autonomy:admitted"},
                {"name": "autonomy:risk-approval-required"},
            ],
        }
        with (
            patch.object(native_auto_merge, "merge_request", return_value=None),
            patch.object(native_auto_merge, "request", return_value=detail),
            patch.object(native_auto_merge, "admission_check", return_value=(True, True)),
            patch.object(native_auto_merge, "enable") as enable,
        ):
            native_auto_merge.reconcile(summary)
        enable.assert_not_called()

    def test_removed_admission_label_preserves_user_auto_merge_request(self):
        summary = {
            "number": 7,
            "labels": [{"name": "autonomy:admitted"}],
            "node_id": "PR_node_7",
        }
        detail = {
            "state": "open",
            "draft": False,
            "base": {"ref": "main"},
            "head": {"sha": "a" * 40},
            "mergeable": True,
            "labels": [],
        }
        active = {"enabledAt": "2026-01-01T00:00:00Z", "mergeMethod": "SQUASH"}
        with (
            patch.object(native_auto_merge, "merge_request", return_value=active),
            patch.object(native_auto_merge, "request", return_value=detail),
            patch.object(native_auto_merge, "admission_check", return_value=(False, True)),
            patch.object(native_auto_merge, "disable") as disable,
        ):
            native_auto_merge.reconcile(summary)
        disable.assert_not_called()

    def test_uncomputed_mergeability_preserves_existing_auto_merge(self):
        summary = {
            "number": 7,
            "labels": [{"name": "autonomy:admitted"}],
            "node_id": "PR_node_7",
        }
        detail = {
            "state": "open",
            "draft": False,
            "base": {"ref": "main"},
            "head": {"sha": "a" * 40},
            "mergeable": None,
            "labels": [{"name": "autonomy:admitted"}],
        }
        active = {"enabledAt": "2026-01-01T00:00:00Z", "mergeMethod": "SQUASH"}
        with (
            patch.object(native_auto_merge, "merge_request", return_value=active),
            patch.object(native_auto_merge, "request", return_value=detail),
            patch.object(native_auto_merge, "admission_check", return_value=(True, True)),
            patch.object(native_auto_merge, "enable") as enable,
            patch.object(native_auto_merge, "disable") as disable,
        ):
            native_auto_merge.reconcile(summary)
        enable.assert_not_called()
        disable.assert_not_called()

    def test_admission_evidence_from_another_pr_does_not_count(self):
        sha = "a" * 40
        statuses = [{
            "context": native_auto_merge.ADMISSION_CHECK,
            "target_url": "https://github.com/owner/repo/pull/99",
            "state": "success",
            "created_at": "2026-10-25T21:00:00Z",
            "creator": {"login": "github-actions[bot]"},
        }]
        with (
            patch.object(native_auto_merge, "REPO", "owner/repo"),
            patch.object(native_auto_merge, "request", return_value=statuses),
        ):
            self.assertEqual(native_auto_merge.admission_check(7, sha), (False, False))

    def test_exact_pr_successful_status_counts_for_admission(self):
        sha = "a" * 40
        statuses = [{
            "context": native_auto_merge.ADMISSION_CHECK,
            "target_url": "https://github.com/owner/repo/pull/7",
            "state": "success",
            "created_at": "2026-10-25T21:00:00Z",
            "creator": {"login": "github-actions[bot]"},
        }]
        with (
            patch.object(native_auto_merge, "REPO", "owner/repo"),
            patch.object(native_auto_merge, "request", return_value=statuses),
        ):
            self.assertEqual(native_auto_merge.admission_check(7, sha), (True, True))

    def test_open_pr_listing_fails_closed_at_safety_limit(self):
        page = [{"number": number} for number in range(100)]
        with patch.object(native_auto_merge, "request", side_effect=[page] * 10) as request:
            with self.assertRaisesRegex(RuntimeError, "1,000-item safety limit"):
                native_auto_merge.pages("/repos/owner/repo/pulls?state=open")
        self.assertEqual(request.call_count, 10)


    def test_native_merge_method_uses_a_strategy_enabled_by_repo(self):
        with patch.object(
            native_auto_merge,
            "request",
            return_value={"allow_squash_merge": False, "allow_merge_commit": True, "allow_rebase_merge": True},
        ):
            self.assertEqual(native_auto_merge.merge_method(), "MERGE")


class RiskApprovalPolicyTests(unittest.TestCase):
    def setUp(self):
        self.sha = "a" * 40
        self.review_path = "/repos/owner/repo/pulls/42/reviews?per_page=100&page=1"
        self.comments_path = "/repos/owner/repo/issues/42/comments?per_page=100&page=1"

    def test_allowlist_is_narrow_and_unknown_or_security_paths_hold(self):
        self.assertFalse(automation.sensitive_file("docs/runbook.md"))
        with patch.object(automation, "REPO", "Jonathan-Harris1975/IRS"):
            self.assertFalse(automation.sensitive_file("public/status.css"))
        self.assertTrue(automation.sensitive_file(".github/workflows/ci.yml"))
        self.assertTrue(automation.sensitive_file("unclassified/new-file.py"))

    def test_recent_owner_review_for_exact_head_is_accepted(self):
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).isoformat()
        with patch.object(automation, "REPO", "owner/repo"), patch.object(
            automation, "get",
            side_effect=[
                [{"user": {"login": "owner"}, "state": "APPROVED", "commit_id": self.sha, "submitted_at": now}],
                [],
            ],
        ):
            self.assertTrue(automation.has_operator_risk_approval(42, self.sha))

    def test_expired_or_wrong_head_owner_review_is_rejected(self):
        from datetime import datetime, timedelta, timezone
        old = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
        for commit_id, submitted_at in ((self.sha, old), ("b" * 40, datetime.now(timezone.utc).isoformat())):
            with self.subTest(commit_id=commit_id, submitted_at=submitted_at), patch.object(
                automation, "REPO", "owner/repo"
            ), patch.object(
                automation, "get",
                side_effect=[
                    [{"user": {"login": "owner"}, "state": "APPROVED", "commit_id": commit_id, "submitted_at": submitted_at}],
                    [],
                ],
            ):
                self.assertFalse(automation.has_operator_risk_approval(42, self.sha))

    def test_unapproved_risky_pr_loses_admission_and_is_held(self):
        pr = {
            "number": 42,
            "head": {"sha": self.sha},
            "labels": [{"name": "autonomy:admitted"}],
        }
        with (
            patch.object(automation, "REPO", "owner/repo"),
            patch.object(automation, "has_operator_risk_approval", return_value=False),
            patch.object(automation, "add_labels") as add,
            patch.object(automation, "remove_label") as remove,
            patch.object(automation, "comment"),
            patch.object(automation, "log"),
        ):
            held = automation.require_operator_risk_approval(
                pr, [".github/workflows/ci.yml"], "managed branch"
            )
        self.assertTrue(held)
        add.assert_called_once_with(42, [automation.RISK_APPROVAL_LABEL])
        remove.assert_called_once_with(42, "autonomy:admitted")



    def test_exact_head_approval_comment_expires_after_seven_days(self):
        from datetime import datetime, timedelta, timezone
        fresh = datetime.now(timezone.utc).isoformat()
        stale = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
        for timestamp, expected in ((fresh, True), (stale, False)):
            with self.subTest(timestamp=timestamp), patch.object(
                automation, "REPO", "owner/repo"
            ), patch.object(
                automation, "get",
                side_effect=[
                    [],
                    [{"user": {"login": "owner"}, "body": f"/risk-approve {self.sha}", "created_at": timestamp}],
                ],
            ):
                self.assertEqual(automation.has_operator_risk_approval(42, self.sha), expected)


if __name__ == "__main__":
    unittest.main()


class KiloControlPlaneProtectionTests(unittest.TestCase):
    def test_kilo_cannot_change_project_overrides_or_its_repair_contract(self):
        root = Path(__file__).resolve().parents[2]
        policy = json.loads((root / "kilo.jsonc").read_text(encoding="utf-8"))
        protected = (
            ".kilo/**",
            ".kilocode/**",
            ".github/kilo-machine-repair-contract.md",
        )
        for tool in ("edit", "write", "apply_patch"):
            rules = policy["permission"][tool]
            for pattern in protected:
                self.assertEqual(rules[pattern], "deny")
                self.assertLess(list(rules).index("*"), list(rules).index(pattern))
