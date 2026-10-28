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
    def run_policy(self, title="fix: correct a bug", body="Fixes #123", labels=(), specification=False, event_name="pull_request"):
        payload = {"pull_request": {"title": title, "body": body, "labels": [{"name": label} for label in labels]}} if event_name == "pull_request" else {}
        with tempfile.TemporaryDirectory() as directory:
            event = Path(directory) / "event.json"
            event.write_text(json.dumps(payload))
            environment = dict(os.environ, GITHUB_EVENT_PATH=str(event), GITHUB_EVENT_NAME=event_name, SPECIFICATION_REPOSITORY=str(specification).lower())
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

    def test_only_queue_metadata_can_skip_pr_metadata_check(self):
        self.assertEqual(self.run_policy(event_name="merge_group").returncode, 0)
        self.assertNotEqual(self.run_policy(event_name="workflow_dispatch").returncode, 0)
