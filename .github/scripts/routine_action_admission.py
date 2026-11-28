"""Strict, content-based admission for routine updates of selected official actions.

No arbitrary workflow, package, dependency or permission change is admitted here.
The trusted caller still requires exact-head CI/security and native merge rules.
"""
from __future__ import annotations

import base64
import re

ACTION_LINE = re.compile(
    r"(?P<prefix>[ \t]*(?:- )?uses:[ \t]+)"
    r"(?P<action>(?:actions/(?:checkout|setup-node|setup-python|upload-artifact|download-artifact|dependency-review-action)|github/codeql-action/(?:init|analyze|autobuild|upload-sarif)))"
    r"@(?P<sha>[0-9a-f]{40}) # (?P<tag>v[0-9]+\.[0-9]+\.[0-9]+)(?P<end>\r?\n?)"
)
SHA = re.compile(r"[0-9a-f]{40}")
WORKFLOW = re.compile(r"\.github/workflows/[A-Za-z0-9_.-]+\.ya?ml")


def version(tag):
    return tuple(int(n) for n in tag[1:].split("."))


def action_pin_updates(before, after):
    """Return exact changed action/tag/SHA tuples, or None for any other edit."""
    old, new = before.splitlines(keepends=True), after.splitlines(keepends=True)
    if len(old) != len(new):
        return None
    updates = set()
    for a, b in zip(old, new):
        if a == b:
            continue
        left, right = ACTION_LINE.fullmatch(a), ACTION_LINE.fullmatch(b)
        if not left or not right:
            return None
        if any(left[k] != right[k] for k in ("prefix", "action", "end")):
            return None
        previous, proposed = version(left["tag"]), version(right["tag"])
        if proposed[0] != previous[0] or proposed <= previous or left["sha"] == right["sha"]:
            return None
        updates.add(("/".join(right["action"].split("/")[:2]), right["tag"], right["sha"]))
    return updates or None


def tag_matches(get, upstream, tag, expected_sha):
    obj = get(f"/repos/{upstream}/git/ref/tags/{tag}")["object"]
    for _ in range(3):
        if obj["type"] == "commit":
            return obj["sha"] == expected_sha
        if obj["type"] != "tag" or not SHA.fullmatch(obj["sha"]):
            return False
        obj = get(f"/repos/{upstream}/git/tags/{obj['sha']}")["object"]
    return False


def workflow_tree(get, repo, commit):
    tree_sha = get(f"/repos/{repo}/git/commits/{commit}")["tree"]["sha"]
    for name in (".github", "workflows"):
        tree = get(f"/repos/{repo}/git/trees/{tree_sha}")
        if tree.get("truncated"):
            raise ValueError("truncated tree")
        entry = next(e for e in tree["tree"] if e["path"] == name)
        if entry["type"] != "tree" or entry["mode"] != "040000":
            raise ValueError("invalid workflow tree")
        tree_sha = entry["sha"]
    tree = get(f"/repos/{repo}/git/trees/{tree_sha}")
    if tree.get("truncated"):
        raise ValueError("truncated workflow tree")
    return {e["path"]: e for e in tree["tree"]}


def blob_text(get, repo, entry):
    if entry["type"] != "blob" or entry["mode"] != "100644":
        raise ValueError("workflow is not a regular file")
    blob = get(f"/repos/{repo}/git/blobs/{entry['sha']}")
    if blob["encoding"] != "base64" or blob.get("size", 0) > 262144:
        raise ValueError("invalid workflow blob")
    return base64.b64decode("".join(blob["content"].split()), validate=True).decode("utf-8")


def verified_routine_action_update(pr, paths, get, repo, default_branch):
    """Prove the complete exact-head diff only upgrades approved official action pins."""
    labels = {item["name"] for item in pr.get("labels", [])}
    head, base = pr.get("head", {}), pr.get("base", {})
    head_sha, base_sha = head.get("sha", ""), base.get("sha", "")
    if (
        pr.get("user", {}).get("login") != "renovate[bot]"
        or pr.get("state") != "open" or pr.get("draft")
        or "dependency:auto-eligible" not in labels or "dependency:manual" in labels
        or head.get("repo", {}).get("full_name") != repo
        or base.get("ref") != default_branch
        or not str(head.get("ref", "")).startswith("renovate/")
        or not SHA.fullmatch(head_sha) or not SHA.fullmatch(base_sha)
        or not paths or len(paths) > 20
        or any(not WORKFLOW.fullmatch(p) for p in paths)
    ):
        return False
    diff = get(f"/repos/{repo}/compare/{base_sha}...{head_sha}")
    if diff.get("merge_base_commit", {}).get("sha") != base_sha:
        return False
    files = diff.get("files", [])
    if len(files) != len(paths) or {f["filename"] for f in files} != set(paths):
        return False
    if any(f.get("status") != "modified" or f.get("previous_filename") for f in files):
        return False
    before = workflow_tree(get, repo, base_sha)
    after = workflow_tree(get, repo, head_sha)
    updates = set()
    for path in paths:
        name = path.rsplit("/", 1)[-1]
        changes = action_pin_updates(blob_text(get, repo, before[name]), blob_text(get, repo, after[name]))
        if not changes:
            return False
        updates.update(changes)
    if not all(tag_matches(get, *update) for update in sorted(updates)):
        return False
    current = get(f"/repos/{repo}/pulls/{pr['number']}")
    return (
        current.get("state") == "open" and not current.get("draft")
        and current.get("head", {}).get("sha") == head_sha
        and current.get("base", {}).get("sha") == base_sha
        and current.get("base", {}).get("ref") == default_branch
        and "dependency:auto-eligible" in {x["name"] for x in current.get("labels", [])}
        and not {x["name"] for x in current.get("labels", [])}.intersection(
            {"dependency:manual", "autonomy:human-hold", "autonomy:council-freeze", "autonomy:obsolete", "autonomy:superseded"}
        )
    )
