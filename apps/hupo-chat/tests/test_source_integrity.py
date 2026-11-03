"""Byte identity with the reviewed native candidate, not native execution."""

import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
GENERATOR_HASHES = {
    "base/namespace-secrets/generate.rb": "4797ce64a2bea6e520e51eef75eb1505d156a02812560de4fde4d511c61d9280",
    "base/namespace-secrets/kubernetes_api.rb": "524b231c4be9744a91a9d34c0128161a433fc5477981186f0f2d960858098c49",
    "base/namespace-secrets/secret_policy.rb": "e89c2c452494919b0a6039878fdd58ae9676c6659a953ccc90bd07be1d5bbc8a",
    "base/namespace-secrets/tests/api_test.rb": "815dd2e5ed57085e2d7de502701f1331c1a9491b2b187431118a4e069c0efd9c",
    "base/namespace-secrets/tests/generator_test.rb": "c61d4861570f393242b9747e6d3f5e7be7bd3a75280547336551daf4cf77b3c5",
    "base/namespace-secrets/tests/policy_test.rb": "02fed569884e09fe0f8e084c7acb05579104a9cf7ac519c05fcb7be119e744b0",
    "base/namespace-secrets/tests/run.rb": "2071060c1a50233bdcf391c67a3d93ece49889f1d7c58ca5c1d06caf50ac8bcb",
    "base/namespace-secrets/tests/support.rb": "ac78c93df1772f0e1aefea7c9e8de58bd75dcb9a2801a102f4b60b2a98ae6afd"
}
RUNTIME_HASHES = {
    "base/runtime/bootstrap.rb": "5e48df4d21c978206711056a075b73c6ce8a14598e37f3619f4b32d94e3c2748",
    "base/runtime/bootstrap_config.rb": "cd7e75a34cd38ddc75d33d25b20cdd09321278e39d091d357cae221734bc3832",
    "base/runtime/check_fcm.rb": "05cfc6efcc7ad5efeb9e78621b1a2fbfcdb3f9f5d175a318c4be1659dca44fca",
    "base/runtime/entrypoint.rb": "44be0fda2a92c49ae8611a3cc2b02acba54e3e9fc7e79969ba10c18b58a839ad",
    "base/runtime/healthcheck.rb": "d110322788a4a3bf37185fd4872fbaf828de91ad8c7d9ca8ced980451ef247c3",
    "base/runtime/lock_onboarding.rb": "4b0d0f80e2cc74cd970de415dd0e54e82e2a5899cb20be5c3c548c2518f7b586"
}


class SourceIntegrityTests(unittest.TestCase):
    def test_generator_and_native_regressions_match_the_reviewed_bytes(self):
        for name, expected in GENERATOR_HASHES.items():
            with self.subTest(source=name):
                self.assertEqual(expected, hashlib.sha256((ROOT / name).read_bytes()).hexdigest())

    def test_guarded_application_runtime_matches_the_reviewed_bytes(self):
        for name, expected in RUNTIME_HASHES.items():
            with self.subTest(source=name):
                self.assertEqual(expected, hashlib.sha256((ROOT / name).read_bytes()).hexdigest())

    def test_owner_job_preserves_the_reviewed_runtime_contract(self):
        owner = json.loads((ROOT / "base/owner-bootstrap.yaml").read_text(encoding="utf-8"))
        owner["metadata"].pop("annotations")
        owner["spec"]["template"]["spec"].pop("nodeSelector")
        raw = json.dumps(owner, sort_keys=True, separators=(",", ":")).encode()
        self.assertEqual("54ee49e4448e3a31d6faa79f6a7c355d3f29a1d3cee2146a892f4f26a523de75", hashlib.sha256(raw).hexdigest())


if __name__ == "__main__":
    unittest.main(verbosity=2)
