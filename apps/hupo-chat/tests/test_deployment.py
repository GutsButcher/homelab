"""Offline contracts for the authoritative, isolated deployment DAG."""

import json
import runpy
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "base"


def document(name, root=BASE):
    return json.loads((root / name).read_text(encoding="utf-8"))


class DeploymentTests(unittest.TestCase):
    def test_namespace_and_data_claims_keep_both_delete_and_prune_safeguards(self):
        protected = [document("namespace.yaml"), document("uploads.yaml")]
        for name in ("postgres.yaml", "redis.yaml"):
            protected.extend(document(name)["spec"]["volumeClaimTemplates"])
        for item in protected:
            options = item["metadata"]["annotations"]["argocd.argoproj.io/sync-options"].split(",")
            self.assertIn("Delete=false", options)
            self.assertIn("Prune=false", options)

    def test_owner_identity_is_an_external_prod_only_input_not_a_plaintext_template(self):
        prod = document("kustomization.yaml", ROOT / "prod")
        self.assertEqual(["../base", "ingressroute.yaml", "owner-identity.sealed.json"], prod["resources"])
        self.assertNotIn("owner-identity.sealed.json", document("kustomization.yaml")["resources"])
        for path in BASE.rglob("*.yaml"):
            value = json.loads(path.read_text(encoding="utf-8"))
            self.assertNotIn(value["kind"], ("Secret", "SealedSecret", "Application", "ApplicationSet"))
        pod = document("namespace-secrets/job.yaml")["spec"]["template"]["spec"]
        identity = next(volume["secret"] for volume in pod["volumes"] if volume["name"] == "identity")
        self.assertEqual("hupo-chat-owner-identity", identity["secretName"])
        self.assertFalse(identity["optional"])

    def test_bundle_contracts_read_the_active_canonical_manifest_tree(self):
        contracts = runpy.run_path(str(BASE / "namespace-secrets/tests/check_bundle.py"))
        self.assertEqual(BASE, contracts["BASE"])
        self.assertEqual(BASE / "namespace-secrets", contracts["ROOT"])
        self.assertNotIn("PRIVATE", contracts)

    def test_all_data_claims_use_the_checked_local_path_class_and_remain_isolated(self):
        uploads = document("uploads.yaml")
        self.assertEqual("0", uploads["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"])
        self.assertEqual("hupo-chat-uploads", uploads["metadata"]["name"])
        claims = [uploads]
        for name in ("postgres.yaml", "redis.yaml"):
            stateful = document(name)
            self.assertEqual(1, stateful["spec"]["replicas"])
            self.assertEqual({"whenDeleted": "Retain", "whenScaled": "Retain"},
                             stateful["spec"].get("persistentVolumeClaimRetentionPolicy"))
            claims.extend(stateful["spec"]["volumeClaimTemplates"])
        for claim in claims:
            with self.subTest(claim=claim["metadata"]["name"]):
                self.assertEqual("local-path", claim["spec"].get("storageClassName"))
                self.assertEqual(["ReadWriteOnce"], claim["spec"]["accessModes"])
                self.assertIn("Delete=false", claim["metadata"]["annotations"]["argocd.argoproj.io/sync-options"])
                self.assertNotIn("volumeName", claim["spec"])
                self.assertNotIn("dataSource", claim["spec"])
        for name in ("web.yaml", "worker.yaml"):
            workload = document(name)
            self.assertEqual(1, workload["spec"]["replicas"])
            self.assertEqual("Recreate", workload["spec"]["strategy"]["type"])
            pod = workload["spec"]["template"]["spec"]
            claims = [volume["persistentVolumeClaim"]["claimName"] for volume in pod["volumes"]
                      if "persistentVolumeClaim" in volume]
            self.assertEqual(["hupo-chat-uploads"], claims)
        affinity = document("worker.yaml")["spec"]["template"]["spec"]["affinity"]["podAffinity"]
        term = affinity["requiredDuringSchedulingIgnoredDuringExecution"][0]
        self.assertEqual("kubernetes.io/hostname", term["topologyKey"])
        self.assertEqual("web", term["labelSelector"]["matchLabels"]["app.kubernetes.io/component"])

    def test_every_application_and_bootstrap_pod_is_pinned_to_the_checked_node(self):
        files = ["postgres.yaml", "redis.yaml", "web.yaml", "worker.yaml", "prepare.yaml",
                 "owner-bootstrap.yaml", "namespace-secrets/job.yaml"]
        for name in files:
            with self.subTest(workload=name):
                pod = document(name)["spec"]["template"]["spec"]
                self.assertEqual({"kubernetes.io/hostname": "node01"}, pod.get("nodeSelector"))
                self.assertNotIn("nodeName", pod)

    def test_owner_bootstrap_runs_after_prepare_before_web_without_identity_api_access(self):
        self.assertIn("owner-bootstrap.yaml", document("kustomization.yaml")["resources"])
        owner = document("owner-bootstrap.yaml")
        annotations = owner["metadata"]["annotations"]
        self.assertEqual("-5", annotations["argocd.argoproj.io/sync-wave"])
        self.assertEqual("Sync", annotations["argocd.argoproj.io/hook"])
        self.assertEqual("BeforeHookCreation,HookSucceeded", annotations["argocd.argoproj.io/hook-delete-policy"])
        self.assertEqual(0, owner["spec"]["backoffLimit"])
        self.assertEqual(300, owner["spec"]["activeDeadlineSeconds"])
        pod = owner["spec"]["template"]["spec"]
        self.assertEqual("hupo-chat", pod["serviceAccountName"])
        self.assertFalse(pod["automountServiceAccountToken"])
        self.assertEqual("Never", pod["restartPolicy"])
        container = pod["containers"][0]
        self.assertEqual(["ruby", "/opt/hupo-chat/entrypoint.rb"], container["command"])
        self.assertEqual(["bundle", "exec", "rails", "runner", "/opt/hupo-chat/bootstrap.rb"], container["args"])
        self.assertEqual(["hupo-chat-secrets", "hupo-chat-owner-bootstrap"],
                         [ref["secretRef"]["name"] for ref in container["envFrom"] if "secretRef" in ref])
        self.assertFalse(any("secret" in volume or "projected" in volume for volume in pod["volumes"]))
        wave = lambda item: int(item["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"])
        self.assertLess(wave(document("prepare.yaml")), wave(owner))
        for name in ("web.yaml", "worker.yaml"):
            self.assertLess(wave(owner), wave(document(name)))

    def test_base_includes_the_self_contained_namespace_bundle(self):
        self.assertIn("namespace-secrets", document("kustomization.yaml")["resources"])
        bundle = BASE / "namespace-secrets"
        self.assertTrue((bundle / "kustomization.yaml").is_file())
        for name in ("generate.rb", "secret_policy.rb", "kubernetes_api.rb"):
            self.assertTrue((bundle / name).is_file())


if __name__ == "__main__":
    unittest.main(verbosity=2)
