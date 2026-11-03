"""Real offline Kustomize checks. No API discovery, schema fetch or activation."""

import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def scratch_root():
    fallback = Path.home() / "AppData/Local/hermes/cache/scratch" if os.name == "nt" else Path(tempfile.gettempdir())
    root = Path(os.environ.get("HUPO_TEST_SCRATCH", fallback))
    root.mkdir(parents=True, exist_ok=True)
    return root


def render(path):
    return subprocess.run(["kubectl", "kustomize", "--load-restrictor=LoadRestrictionsRootOnly", str(path)],
                          capture_output=True, text=True, encoding="utf-8", timeout=90, cwd=scratch_root())


def records(text):
    """Read only Kustomize's top-level metadata, not general YAML or secret data."""
    result = []
    for block in re.split(r"(?m)^---\s*$", text):
        if not block.strip():
            continue
        kind = re.search(r"(?m)^kind: (\S+)$", block)
        metadata = re.search(r"(?ms)^metadata:\n(.*?)(?=^\S|\Z)", block)
        if not kind or not metadata:
            raise AssertionError("renderer did not emit recognizable object metadata")
        name = re.search(r"(?m)^  name: (\S+)$", metadata[1])
        namespace = re.search(r"(?m)^  namespace: (\S+)$", metadata[1])
        wave = re.search(r'argocd.argoproj.io/sync-wave: "?(-?\d+)"?', metadata[1])
        if not name:
            raise AssertionError("rendered object has no metadata name")
        result.append({"kind": kind[1], "name": name[1], "namespace": namespace[1] if namespace else None,
                       "wave": int(wave[1]) if wave else None, "body": block})
    return result


class RenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.outputs = {}
        for overlay in ("base/namespace-secrets", "base", "prod"):
            result = render(ROOT / overlay)
            if result.returncode or result.stderr:
                raise AssertionError(f"offline render failed for {overlay}. No manifests printed.")
            cls.outputs[overlay] = records(result.stdout)

    def test_all_overlays_resolve_the_hashed_generator_code_reference(self):
        names = []
        for overlay, objects in self.outputs.items():
            with self.subTest(overlay=overlay):
                code = [item["name"] for item in objects if item["kind"] == "ConfigMap" and
                        item["name"].startswith("hupo-chat-namespace-secrets-code-")]
                self.assertEqual(1, len(code))
                self.assertRegex(code[0], r"^hupo-chat-namespace-secrets-code-[a-z0-9]{10}$")
                job = next(item for item in objects if item["kind"] == "Job" and
                           item["name"] == "hupo-chat-namespace-secrets")
                references = re.findall(r"(?m)^\s+name: (hupo-chat-namespace-secrets-code(?:-[a-z0-9]+)?)$", job["body"])
                self.assertEqual(code, references)
                names.extend(code)
        self.assertEqual(1, len(set(names)))

    def test_combined_overlays_have_only_the_isolated_expected_objects(self):
        self.assertEqual(7, len(self.outputs["base/namespace-secrets"]))
        self.assertEqual(26, len(self.outputs["base"]))
        self.assertEqual(28, len(self.outputs["prod"]))
        identities = lambda objects: {(item["kind"], item["name"]) for item in objects}
        self.assertEqual(identities(self.outputs["base"]) |
                         {("SealedSecret", "hupo-chat-owner-identity"), ("IngressRoute", "hupo-chat")},
                         identities(self.outputs["prod"]))
        for objects in self.outputs.values():
            for item in objects:
                self.assertNotIn(item["kind"], ("Secret", "Application", "ApplicationSet", "ClusterRole", "ClusterRoleBinding"))
                self.assertEqual("hupo-chat" if item["kind"] != "Namespace" else None, item["namespace"])

    def test_combined_renders_pin_all_seven_pods_to_node01(self):
        for overlay in ("base", "prod"):
            pods = [item for item in self.outputs[overlay] if item["kind"] in ("Deployment", "StatefulSet", "Job")]
            self.assertEqual(7, len(pods))
            for item in pods:
                pins = re.findall(r"(?m)^\s+kubernetes.io/hostname: (\S+)$", item["body"])
                self.assertEqual(["node01"], pins, f"wrong node pin for {item['name']}")

    def test_prod_renders_the_complete_dag_including_parent_identity(self):
        waves = {item["name"]: item["wave"] for item in self.outputs["prod"]}
        expected = {"hupo-chat-owner-identity": -39, "hupo-chat-namespace-secrets-code-": -38,
                    "hupo-chat-namespace-secrets": -35, "hupo-chat-config": -30,
                    "hupo-chat-runtime": -30, "hupo-chat-postgres": -20, "hupo-chat-redis": -20,
                    "hupo-chat-prepare": -10, "hupo-chat-owner-bootstrap": -5,
                    "hupo-chat-uploads": 0, "hupo-chat-web": 0, "hupo-chat-worker": 0}
        for name, wave in expected.items():
            if name.endswith("code-"):
                name = next(key for key in waves if key.startswith(name))
            self.assertEqual(wave, waves[name], f"wrong wave for {name}")
        namespace = next(item for item in self.outputs["prod"] if item["kind"] == "Namespace")
        self.assertEqual(-40, namespace["wave"])
        ingress = next(item for item in self.outputs["prod"] if item["kind"] == "IngressRoute")
        self.assertEqual(10, ingress["wave"])

    def test_prod_without_real_identity_fails_instead_of_inventing_a_secret(self):
        with tempfile.TemporaryDirectory(prefix="hupo-missing-input-", dir=scratch_root()) as folder:
            candidate = Path(folder)
            shutil.copytree(ROOT / "base", candidate / "base")
            (candidate / "prod").mkdir()
            for name in ("kustomization.yaml", "ingressroute.yaml"):
                shutil.copy2(ROOT / "prod" / name, candidate / "prod" / name)
            result = render(candidate / "prod")
            self.assertNotEqual(0, result.returncode)
            self.assertIn("owner-identity.sealed.json", result.stderr)
            self.assertEqual("", result.stdout)
            self.assertFalse((candidate / "prod/owner-identity.sealed.json").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
