"""Offline source/manifest contracts; these do not execute or parse Ruby."""

import ipaddress
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT.parent
IMAGE = "chatwoot/chatwoot:v4.19.1-ce@sha256:04895c7bd0550d9e74b45b7202787b56f7ee4e891ebbde0c429c8c32901b97cf"
NAMESPACE = "hupo-chat"
LABELS = {"app.kubernetes.io/name": "hupo-chat-namespace-secrets"}


def document(name, root=ROOT):
    return json.loads((root / name).read_text(encoding="utf-8"))


def pvc_names():
    names = [document("uploads.yaml", BASE)["metadata"]["name"]]
    for name in ("postgres.yaml", "redis.yaml"):
        stateful = document(name, BASE)
        for claim in stateful["spec"]["volumeClaimTemplates"]:
            for ordinal in range(stateful["spec"]["replicas"]):
                names.append(f'{claim["metadata"]["name"]}-{stateful["metadata"]["name"]}-{ordinal}')
    return sorted(names)


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((ROOT / "kustomization.yaml").is_file(), "inert bundle is not implemented")
        self.kustomization = document("kustomization.yaml")
        self.job = document("job.yaml")
        self.pod = self.job["spec"]["template"]["spec"]
        self.container = self.pod["containers"][0]

    def test_kustomization_is_local_and_does_not_activate_any_application(self):
        self.assertEqual(NAMESPACE, self.kustomization["namespace"])
        for name in self.kustomization["resources"]:
            self.assertEqual(Path(name).name, name)
            resource = document(name)
            self.assertNotIn(resource["kind"], ("Application", "ApplicationSet", "Namespace", "Secret"))
            self.assertEqual(NAMESPACE, resource["metadata"]["namespace"])
        generator = self.kustomization["configMapGenerator"][0]
        self.assertEqual(["generate.rb", "secret_policy.rb", "kubernetes_api.rb"], generator["files"])
        self.assertFalse(self.kustomization["generatorOptions"]["disableNameSuffixHash"])

    def test_rbac_has_only_create_secrets_and_exact_named_reads(self):
        rules = document("role.yaml")["rules"]
        self.assertEqual(3, len(rules))
        self.assertIn({"apiGroups": [""], "resources": ["secrets"], "verbs": ["create"]}, rules)
        named = {rule["resources"][0]: rule for rule in rules if "resourceNames" in rule}
        self.assertEqual(["get"], named["secrets"]["verbs"])
        self.assertEqual(["hupo-chat-owner-bootstrap", "hupo-chat-secrets"], sorted(named["secrets"]["resourceNames"]))
        self.assertEqual(["get"], named["persistentvolumeclaims"]["verbs"])
        self.assertEqual(pvc_names(), sorted(named["persistentvolumeclaims"]["resourceNames"]))
        self.assertEqual(3, len(pvc_names()))
        self.assertEqual([""], named["persistentvolumeclaims"]["apiGroups"])
        self.assertEqual([""], named["secrets"]["apiGroups"])

    def test_service_account_is_dedicated_and_not_ambient(self):
        account = document("service-account.yaml")
        self.assertFalse(account["automountServiceAccountToken"])
        self.assertEqual(account["metadata"]["name"], self.pod["serviceAccountName"])
        self.assertFalse(self.pod["automountServiceAccountToken"])
        binding = document("role-binding.yaml")
        self.assertEqual("Role", binding["roleRef"]["kind"])
        self.assertEqual(document("role.yaml")["metadata"]["name"], binding["roleRef"]["name"])
        self.assertEqual([{"kind": "ServiceAccount", "name": account["metadata"]["name"], "namespace": NAMESPACE}], binding["subjects"])

    def test_waves_are_after_namespace_and_before_every_declared_pvc_consumer(self):
        wave = lambda obj: int(obj["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"])
        namespace_wave = wave(document("namespace.yaml", BASE))
        job_wave = wave(self.job)
        for name in self.kustomization["resources"]:
            if name != "job.yaml":
                self.assertLess(namespace_wave, wave(document(name)))
                self.assertLess(wave(document(name)), job_wave)
        self.assertLess(namespace_wave, job_wave)
        for name in ("postgres.yaml", "redis.yaml", "uploads.yaml"):
            self.assertLess(job_wave, wave(document(name, BASE)))
        self.assertEqual("Sync", self.job["metadata"]["annotations"]["argocd.argoproj.io/hook"])
        self.assertEqual("BeforeHookCreation", self.job["metadata"]["annotations"]["argocd.argoproj.io/hook-delete-policy"])
        self.assertEqual("-38", self.kustomization["generatorOptions"]["annotations"]["argocd.argoproj.io/sync-wave"])

    def test_job_is_bounded_pinned_non_root_and_has_no_database_startup(self):
        self.assertEqual(IMAGE, self.container["image"])
        self.assertEqual(["ruby", "/opt/hupo-chat-namespace-secrets/generate.rb", "--run-in-cluster"], self.container["command"])
        self.assertEqual({"kubernetes.io/hostname": "node01"}, self.pod["nodeSelector"])
        self.assertEqual("Never", self.pod["restartPolicy"])
        self.assertEqual(0, self.job["spec"]["backoffLimit"])
        self.assertLessEqual(self.job["spec"]["activeDeadlineSeconds"], 180)
        self.assertLessEqual(self.job["spec"]["ttlSecondsAfterFinished"], 600)
        security = self.pod["securityContext"]
        self.assertEqual(1000, security["runAsUser"])
        self.assertEqual(1000, security["runAsGroup"])
        self.assertEqual(1000, security["fsGroup"])
        self.assertTrue(security["runAsNonRoot"])
        self.assertEqual({"type": "RuntimeDefault"}, security["seccompProfile"])
        self.assertEqual({"allowPrivilegeEscalation": False, "readOnlyRootFilesystem": True, "capabilities": {"drop": ["ALL"]}}, self.container["securityContext"])
        self.assertNotIn("envFrom", self.container)
        self.assertNotIn("args", self.container)
        for key in ("hostNetwork", "hostPID", "hostIPC", "initContainers"):
            self.assertFalse(self.pod.get(key))
        self.assertEqual({"requests": {"cpu": "25m", "memory": "64Mi"}, "limits": {"cpu": "250m", "memory": "192Mi"}}, self.container["resources"])

    def test_only_read_only_code_identity_ca_and_short_lived_token_volumes(self):
        volumes = {volume["name"]: volume for volume in self.pod["volumes"]}
        self.assertEqual({"code", "identity", "api-access"}, set(volumes))
        self.assertEqual("hupo-chat-owner-identity", volumes["identity"]["secret"]["secretName"])
        self.assertFalse(volumes["identity"]["secret"]["optional"])
        sources = volumes["api-access"]["projected"]["sources"]
        tokens = [source["serviceAccountToken"] for source in sources if "serviceAccountToken" in source]
        self.assertEqual([{"path": "token", "expirationSeconds": 600, "audience": "https://kubernetes.default.svc.cluster.local"}], tokens)
        ca = [source["configMap"] for source in sources if "configMap" in source]
        self.assertEqual([{"name": "kube-root-ca.crt", "items": [{"key": "ca.crt", "path": "ca.crt"}], "optional": False}], ca)
        self.assertEqual(2, len(sources))
        for mount in self.container["volumeMounts"]:
            self.assertTrue(mount["readOnly"])
            self.assertNotIn("subPath", mount)
        self.assertNotIn("items", volumes["identity"]["secret"])

    def test_network_policy_selects_only_this_job_and_denies_ingress(self):
        labels = self.job["spec"]["template"]["metadata"]["labels"]
        for name in ("network-dns.yaml", "network-api.yaml"):
            policy = document(name)["spec"]
            self.assertEqual(LABELS, policy["podSelector"]["matchLabels"])
            self.assertTrue(all(labels.get(key) == value for key, value in LABELS.items()))
            self.assertEqual([], policy["ingress"])
            self.assertEqual(["Ingress", "Egress"], policy["policyTypes"])
        dns = document("network-dns.yaml")["spec"]["egress"]
        self.assertEqual(1, len(dns))
        self.assertEqual([{"namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": "kube-system"}}, "podSelector": {"matchLabels": {"k8s-app": "kube-dns"}}}], dns[0]["to"])
        self.assertEqual([{"port": 53, "protocol": "UDP"}, {"port": 53, "protocol": "TCP"}], dns[0]["ports"])

    def test_api_egress_reuses_only_the_approved_p0_single_host_allowset(self):
        policy = document("network-api.yaml")
        expected = [
            {"to": [{"ipBlock": {"cidr": "10.43.0.1/32"}}],
             "ports": [{"protocol": "TCP", "port": 443}]},
            {"to": [{"ipBlock": {"cidr": "192.168.100.191/32"}},
                    {"ipBlock": {"cidr": "192.168.100.229/32"}}],
             "ports": [{"protocol": "TCP", "port": 6443}]},
        ]
        self.assertEqual(expected, policy["spec"]["egress"])
        self.assertEqual("hupo-chat-preflight-bounded-allowset",
                         policy["metadata"]["annotations"].get("hupo.chat/api-egress-source"))
        self.assertNotIn("hupo.chat/integration-required", policy["metadata"]["annotations"])
        for rule in policy["spec"]["egress"]:
            self.assertTrue(rule["to"])
            for peer in rule["to"]:
                self.assertEqual({"ipBlock"}, set(peer))
                network = ipaddress.ip_network(peer["ipBlock"]["cidr"], strict=True)
                self.assertEqual(network.max_prefixlen, network.prefixlen)
                self.assertFalse(network.network_address.is_unspecified)
                self.assertFalse(network.network_address.is_multicast)
                self.assertFalse(network.network_address.is_loopback)
            self.assertTrue(rule["ports"])
            for port in rule["ports"]:
                self.assertEqual("TCP", port["protocol"])
                self.assertIsInstance(port["port"], int)
                self.assertGreater(port["port"], 0)
                self.assertLess(port["port"], 65536)

    def test_generator_contract_matches_the_canonical_six_required_keys(self):
        entrypoint = (BASE / "runtime/entrypoint.rb").read_text(encoding="utf-8")
        runtime_keys = re.search(r"SECRET_KEYS = %w\[([^]]+)\]", entrypoint).group(1).split()
        required_keys = sorted(set(runtime_keys) - {"SMTP_PASSWORD"})
        source = (ROOT / "secret_policy.rb").read_text(encoding="utf-8")
        self.assertEqual(NAMESPACE, document("kustomization.yaml", BASE)["namespace"])
        runtime_mapping = source.split("RUNTIME_BYTES = {", 1)[1].split("}.freeze", 1)[0]
        declared_keys = re.findall(r"'([A-Z_]+)'\s*=>", runtime_mapping)
        self.assertEqual(required_keys, sorted(declared_keys))
        self.assertEqual(6, len(declared_keys))
        for key in ("MAILER_SENDER_EMAIL", "SMTP_ADDRESS", "SMTP_PORT", "SMTP_USERNAME",
                    "SMTP_PASSWORD", "SMTP_AUTHENTICATION", "SMTP_DOMAIN",
                    "FIREBASE_PROJECT_ID", "FIREBASE_CREDENTIALS"):
            self.assertNotRegex(source, rf"['\"]{key}['\"]")
        api_source = (ROOT / "kubernetes_api.rb").read_text(encoding="utf-8")
        declared_pvcs = re.search(r"PVC_NAMES = %w\[([^]]+)\]", api_source).group(1).split()
        self.assertEqual(pvc_names(), sorted(declared_pvcs))
        declared_secrets = re.search(r"SECRET_NAMES = %w\[([^]]+)\]", api_source).group(1).split()
        self.assertEqual(["hupo-chat-owner-bootstrap", "hupo-chat-secrets"], sorted(declared_secrets))

    def test_transport_source_contracts_are_explicit_not_runtime_proof(self):
        source = (ROOT / "kubernetes_api.rb").read_text(encoding="utf-8")
        for text in ("kubernetes.default.svc.cluster.local", "VERIFY_PEER", "verify_hostname = true", "max_retries = 0", "read_timeout = 3", "write_timeout = 3", "open_timeout = 2", "read_body", "MAX_BODY", "Timeout.timeout", "HOST, 443, nil"):
            self.assertIn(text, source)
        self.assertNotRegex(source, r"VERIFY_NONE|ENV\[|URI\.parse|set_debug_output")

    def test_ruby_sources_have_no_process_launch_or_secret_printing(self):
        for name in ("generate.rb", "secret_policy.rb", "kubernetes_api.rb"):
            source = (ROOT / name).read_text(encoding="utf-8")
            self.assertNotRegex(source, r"\b(system|exec|eval|spawn|popen)\s*\(")
            self.assertNotRegex(source, r"File\.(write|binwrite)|\.inspect\b|warn\b|puts\b|print\b")
            self.assertLessEqual(len(source.splitlines()), 300)
        self.assertIn("$PROGRAM_NAME == __FILE__", (ROOT / "generate.rb").read_text(encoding="utf-8"))

    def test_docs_state_runtime_and_integration_limits(self):
        text = (ROOT / "README.md").read_text(encoding="utf-8")
        for phrase in ("Ruby is unavailable", "not executed", "API egress", "partial", "retained", "owner-identity", "Prune=false", "no runtime success"):
            self.assertIn(phrase, text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
