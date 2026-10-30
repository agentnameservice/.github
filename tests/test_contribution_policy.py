# SPDX-License-Identifier: Apache-2.0
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/contribution-policy.yml"


def script():
    source = WORKFLOW.read_text().split("python3 - <<'PY'\n", 1)[1].split("          PY", 1)[0]
    return "\n".join(line[10:] for line in source.splitlines())


class ContributionPolicyTests(unittest.TestCase):
    def run_policy(self, title="fix: correct a bug", body="Fixes #123", labels=(), specification=False, event_name="pull_request", author="contributor", author_type="User", actor="maintainer"):
        payload = {"pull_request": {"title": title, "body": body, "labels": [{"name": label} for label in labels], "user": {"login": author, "type": author_type}}} if event_name == "pull_request" else {}
        with tempfile.TemporaryDirectory() as directory:
            event = Path(directory) / "event.json"
            event.write_text(json.dumps(payload))
            environment = dict(os.environ, GITHUB_EVENT_PATH=str(event), GITHUB_EVENT_NAME=event_name, GITHUB_ACTOR=actor, SPECIFICATION_REPOSITORY=str(specification).lower())
            return subprocess.run([sys.executable, "-c", script()], env=environment, text=True, capture_output=True, check=False)

    def test_valid_pull_request(self):
        self.assertEqual(self.run_policy().returncode, 0)

    def test_template_comments_are_not_issue_links(self):
        self.assertNotEqual(self.run_policy(body="<!-- Fixes #123 -->\nFixes #").returncode, 0)

    def test_closing_and_non_closing_issue_references(self):
        for body in [
            "Fixes #123", "Closes #123", "Resolves #123", "Refs #123", "Related: #123",
            "Refs agentnameservice/ans-spec#123",
            "Related: https://github.com/agentnameservice/ans-spec/issues/123",
            "[Proposal](https://github.com/agentnameservice/ans-spec/issues/123)",
        ]:
            with self.subTest(body=body):
                self.assertEqual(self.run_policy(body=body).returncode, 0)

    def test_issue_reference_placeholders_do_not_pass(self):
        for body in ["Fixes #", "Refs #NNN", "Refs #0", "Refs #123abc", "Refs owner/repo#NNN", "https://github.com/owner/repo/issues/NNN"]:
            with self.subTest(body=body):
                self.assertNotEqual(self.run_policy(body=body).returncode, 0)

    def test_no_issue_explanation_allows_self_contained_changes(self):
        for title in ["feat(cli): add JSON output", "fix: correct a bug", "docs: fix a typo"]:
            with self.subTest(title=title):
                result = self.run_policy(title=title, body="## Related issue\n\nNo issue needed: Self-contained change using existing behavior.")
                self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(self.run_policy(body="no issue needed: Local test coverage.", labels=["editorial"], specification=True).returncode, 0)

    def test_empty_and_placeholder_explanations_do_not_pass(self):
        for body in [
            None, "", "No issue needed:", "No issue needed: \t",
            "No issue needed:\n\n## Summary\nFix a typo.",
            "No issue needed:\r\n## Summary\r\nFix a typo.",
            "No issue needed: <!-- reason -->", "<!-- No issue needed: Fix a typo. -->",
            "No issue needed: <brief reason>", "No issue needed: [brief reason]",
            "No issue needed: ...", "No issue needed: …",
        ]:
            with self.subTest(body=body):
                result = self.run_policy(body=body)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Reference an issue", result.stdout)

    def test_mandatory_issue_conditions_override_exemptions(self):
        for title, labels, footer in [
            ("spec: update requirements", ["normative"], ""),
            ("feat: add integration", ["issue-required"], ""),
            ("feat!: remove old option", [], ""),
            ("feat(cli)!: remove old option", [], ""),
            ("feat: remove old option", [], "\n\nBREAKING CHANGE: The old option is removed."),
            ("feat: remove old option", [], "\n\nBREAKING-CHANGE: The old option is removed."),
        ]:
            for author, author_type in [("contributor", "User"), ("dependabot[bot]", "Bot")]:
                for body, allowed in [("", False), ("No issue needed: Self-contained change.", False), ("Refs #123", True)]:
                    with self.subTest(title=title, labels=labels, footer=footer, author=author, body=body):
                        result = self.run_policy(title=title, labels=labels, body=body + footer, author=author, author_type=author_type)
                        self.assertEqual(result.returncode, 0 if allowed else 1, result.stdout)
                        if not allowed:
                            self.assertIn("Link an issue or proposal", result.stdout)

    def test_issue_required_label_removal_allows_explanation(self):
        body = "No issue needed: Self-contained change."
        self.assertNotEqual(self.run_policy(body=body, labels=["issue-required"]).returncode, 0)
        self.assertEqual(self.run_policy(body=body).returncode, 0)

    def test_breaking_change_template_comment_does_not_require_issue(self):
        body = "<!-- BREAKING CHANGE: describe here -->\nNo issue needed: Local test coverage."
        self.assertEqual(self.run_policy(body=body).returncode, 0)

    def test_normative_and_editorial_are_exclusive(self):
        self.assertEqual(self.run_policy(labels=["normative"], specification=True).returncode, 0)
        for labels in [[], ["normative", "editorial"]]:
            self.assertNotEqual(self.run_policy(labels=labels, specification=True).returncode, 0)

    def test_untrusted_strings_are_data_and_bad_titles_fail(self):
        result = self.run_policy(title="fix: $(exit 99)", body="Fixes #123\n`exit 99`")
        self.assertEqual(result.returncode, 0)
        self.assertNotEqual(self.run_policy(title="please merge").returncode, 0)

    def test_dependabot_does_not_need_issue_link(self):
        result = self.run_policy(title="chore(deps): bump js-yaml from 4.3.1 to 4.3.2", body="Bumps js-yaml from 4.3.1 to 4.3.2.", author="dependabot[bot]", author_type="Bot")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_issue_exemption_requires_dependabot_author(self):
        for author, author_type in [("contributor", "User"), ("renovate[bot]", "Bot"), ("dependabot[bot]", "User")]:
            with self.subTest(author=author, author_type=author_type):
                result = self.run_policy(title="chore(deps): bump js-yaml", body="Bumps js-yaml.", author=author, author_type=author_type, actor="dependabot[bot]")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Reference an issue", result.stdout)

    def test_dependabot_still_requires_conventional_title(self):
        result = self.run_policy(title="Bump js-yaml", body="", author="dependabot[bot]", author_type="Bot")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Conventional Commit", result.stdout)
        self.assertNotIn("Reference an issue", result.stdout)

    def test_dependabot_still_requires_specification_label(self):
        for labels in [[], ["editorial", "normative"], ["editorial"], ["normative"]]:
            with self.subTest(labels=labels):
                result = self.run_policy(body="Refs #123" if "normative" in labels else "", labels=labels, specification=True, author="dependabot[bot]", author_type="Bot")
                self.assertEqual(result.returncode, 0 if len(labels) == 1 else 1, result.stdout)
                self.assertNotIn("Reference an issue", result.stdout)

    def test_events_without_a_pull_request_are_rejected(self):
        for event_name in ["merge_group", "workflow_dispatch"]:
            self.assertNotEqual(self.run_policy(event_name=event_name).returncode, 0)
