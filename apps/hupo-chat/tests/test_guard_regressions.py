"""Prove that the active canonical guards reject unsafe source mutations."""

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from test_render import ROOT, scratch_root

RUNNER = """
import json
import runpy
import sys
import unittest

namespace = runpy.run_path(sys.argv[1], run_name="candidate")
suite = unittest.TestSuite([namespace[sys.argv[2]](sys.argv[3])])
result = unittest.TestResult()
suite.run(result)
print(json.dumps({"tests_run": result.testsRun,
                  "failures": [test.id() for test, _ in result.failures],
                  "errors": [test.id() for test, _ in result.errors]}))
sys.exit(0 if result.wasSuccessful() else 1)
"""


class GuardRegressionTests(unittest.TestCase):
    def test_real_guards_reject_node_wave_api_and_rbac_mutations(self):
        cases = (
            ("base/web.yaml", self.change_node, "tests/test_deployment.py", "DeploymentTests",
             "test_every_application_and_bootstrap_pod_is_pinned_to_the_checked_node", " (workload='web.yaml')"),
            ("base/owner-bootstrap.yaml", self.change_wave, "tests/test_deployment.py", "DeploymentTests",
             "test_owner_bootstrap_runs_after_prepare_before_web_without_identity_api_access", ""),
            ("base/namespace-secrets/network-api.yaml", self.widen_api, "base/namespace-secrets/tests/check_bundle.py",
             "BundleTests", "test_api_egress_reuses_only_the_approved_p0_single_host_allowset", ""),
            ("base/namespace-secrets/role.yaml", self.widen_secret_reads, "base/namespace-secrets/tests/check_bundle.py",
             "BundleTests", "test_rbac_has_only_create_secrets_and_exact_named_reads", ""),
        )
        for relative, mutate, script, case, method, suffix in cases:
            with self.subTest(mutation=relative), self.candidate() as folder:
                candidate = Path(folder)
                path = candidate / relative
                value = json.loads(path.read_text(encoding="utf-8"))
                mutate(value)
                path.write_text(json.dumps(value), encoding="utf-8")
                result, summary = self.run_guard(candidate, script, case, method)
                self.assert_guard_failure(result, summary, f"candidate.{case}.{method}{suffix}")

    def test_a_missing_manifest_is_an_error_not_a_successful_negative_guard(self):
        with self.candidate() as folder:
            candidate = Path(folder)
            (candidate / "base/web.yaml").unlink()
            method = "test_every_application_and_bootstrap_pod_is_pinned_to_the_checked_node"
            result, summary = self.run_guard(candidate, "tests/test_deployment.py", "DeploymentTests", method)
            self.assertEqual([], summary["failures"])
            self.assertTrue(summary["errors"])
            with self.assertRaises(AssertionError):
                self.assert_guard_failure(result, summary, f"candidate.DeploymentTests.{method}")

    def candidate(self):
        folder = tempfile.TemporaryDirectory(prefix="hupo-guard-", dir=scratch_root())
        candidate = Path(folder.name)
        for subtree in ("base", "tests"):
            shutil.copytree(ROOT / subtree, candidate / subtree)
        return folder

    def run_guard(self, candidate, script, case, method):
        result = subprocess.run([sys.executable, "-B", "-c", RUNNER,
                                 str(candidate / script), case, method], cwd=candidate,
                                capture_output=True, text=True, encoding="utf-8", timeout=30)
        return result, json.loads(result.stdout)

    def assert_guard_failure(self, result, summary, expected):
        self.assertEqual(1, result.returncode)
        self.assertEqual(1, summary["tests_run"])
        self.assertEqual([], summary["errors"])
        self.assertEqual([expected], summary["failures"])
        self.assertEqual("", result.stderr)

    @staticmethod
    def change_node(value):
        value["spec"]["template"]["spec"]["nodeSelector"]["kubernetes.io/hostname"] = "node02"

    @staticmethod
    def change_wave(value):
        value["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"] = "0"

    @staticmethod
    def widen_api(value):
        value["spec"]["egress"][0]["to"][0]["ipBlock"]["cidr"] = "0.0.0.0/0"

    @staticmethod
    def widen_secret_reads(value):
        value["rules"][1]["resourceNames"].append("hupo-chat-owner-identity")


if __name__ == "__main__":
    unittest.main(verbosity=2)
