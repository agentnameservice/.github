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
                self.assertIn("Link a real issue", result.stdout)

    def test_dependabot_still_requires_conventional_title(self):
        result = self.run_policy(title="Bump js-yaml", body="", author="dependabot[bot]", author_type="Bot")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Conventional Commit", result.stdout)
        self.assertNotIn("Link a real issue", result.stdout)

    def test_dependabot_still_requires_specification_label(self):
        for labels in [[], ["editorial", "normative"], ["editorial"], ["normative"]]:
            with self.subTest(labels=labels):
                result = self.run_policy(body="", labels=labels, specification=True, author="dependabot[bot]", author_type="Bot")
                self.assertEqual(result.returncode, 0 if len(labels) == 1 else 1, result.stdout)
                self.assertNotIn("Link a real issue", result.stdout)

    def test_events_without_a_pull_request_are_rejected(self):
        for event_name in ["merge_group", "workflow_dispatch"]:
            self.assertNotEqual(self.run_policy(event_name=event_name).returncode, 0)
