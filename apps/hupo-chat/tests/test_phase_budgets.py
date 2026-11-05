"""Static phase inputs for the parent-owned capacity check, not live capacity."""

from decimal import Decimal
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
FILES = ("postgres", "redis", "web", "worker", "prepare", "owner-bootstrap", "namespace-secrets/job")
DATA = ["hupo-chat-postgres", "hupo-chat-redis"]
STEADY = DATA + ["hupo-chat-web", "hupo-chat-worker"]
PHASES = (
    ("generator_first_install", -35, ["hupo-chat-namespace-secrets"]),
    ("data_first_install", -20, DATA),
    ("prepare_first_install", -10, DATA + ["hupo-chat-prepare"]),
    ("owner_first_install", -5, DATA + ["hupo-chat-owner-bootstrap"]),
    ("steady", 0, STEADY),
    ("generator_repeat_sync", -35, STEADY + ["hupo-chat-namespace-secrets"]),
    ("prepare_repeat_sync", -10, STEADY + ["hupo-chat-prepare"]),
    ("owner_repeat_sync", -5, STEADY + ["hupo-chat-owner-bootstrap"]),
)


class WorkloadBudget:
    def __init__(self, document):
        self.name = document["metadata"]["name"]
        self.replicas = document["spec"].get("replicas", 1)
        self.pod = document["spec"]["template"]["spec"]

    def totals(self):
        if any(key in self.pod for key in ("initContainers", "overhead", "resources")):
            raise AssertionError("phase calculator needs review for new pod-level or init budgets")
        result = {}
        for budget in ("requests", "limits"):
            resources = [container["resources"][budget] for container in self.pod["containers"]]
            result[budget] = {
                "cpuMilli": self.replicas * sum(self.cpu_milli(item["cpu"]) for item in resources),
                "memoryBytes": self.replicas * sum(self.memory_bytes(item["memory"]) for item in resources),
            }
        result["emptyDirBytes"] = self.replicas * sum(
            self.memory_bytes(volume["emptyDir"]["sizeLimit"])
            for volume in self.pod.get("volumes", []) if "emptyDir" in volume
        )
        return result

    @staticmethod
    def cpu_milli(value):
        return int(Decimal(value[:-1])) if value.endswith("m") else int(Decimal(value) * 1000)

    @staticmethod
    def memory_bytes(value):
        factors = {"Mi": 1024 ** 2, "Gi": 1024 ** 3}
        return int(Decimal(value[:-2]) * factors[value[-2:]])


def phase_inputs():
    documents = [json.loads((ROOT / "base" / f"{name}.yaml").read_text(encoding="utf-8")) for name in FILES]
    workloads = {item["metadata"]["name"]: WorkloadBudget(item).totals() for item in documents}
    phases = []
    for name, wave, members in PHASES:
        phase = {"name": name, "wave": wave, "workloads": members}
        for budget in ("requests", "limits"):
            phase[budget] = {resource: sum(workloads[member][budget][resource] for member in members)
                             for resource in ("cpuMilli", "memoryBytes")}
        phase["emptyDirBytes"] = sum(workloads[member]["emptyDirBytes"] for member in members)
        phases.append(phase)
    claims = [json.loads((ROOT / "base/uploads.yaml").read_text(encoding="utf-8"))]
    for document in documents:
        claims.extend(document["spec"].get("volumeClaimTemplates", []))
    return {
        "schemaVersion": 1,
        "namespace": "hupo-chat",
        "targetNode": "node01",
        "scope": "Manifest inputs only. Sync hooks do not overlap. Existing steady pods remain on repeat sync.",
        "pvcBytes": sum(WorkloadBudget.memory_bytes(claim["spec"]["resources"]["requests"]["storage"])
                        for claim in claims),
        "phases": phases,
        "peakMemoryLimitBytes": max(phase["limits"]["memoryBytes"] for phase in phases),
        "peakEmptyDirBytes": max(phase["emptyDirBytes"] for phase in phases),
    }


class PhaseBudgetTests(unittest.TestCase):
    def test_record_matches_each_active_manifest_phase(self):
        path = ROOT / "phase-budgets.json"
        self.assertTrue(path.is_file(), "phase budgets must be recorded for parent P0 integration")
        self.assertEqual(phase_inputs(), json.loads(path.read_text(encoding="utf-8")))

    def test_early_jobs_do_not_raise_the_existing_conservative_peak(self):
        result = phase_inputs()
        self.assertEqual(6656 * 1024 ** 2, result["peakMemoryLimitBytes"])
        self.assertEqual(2192 * 1024 ** 2, result["peakEmptyDirBytes"])
        self.assertEqual(42 * 1024 ** 3, result["pvcBytes"])
        for name in ("prepare_first_install", "owner_first_install"):
            phase = next(item for item in result["phases"] if item["name"] == name)
            self.assertEqual(2560 * 1024 ** 2, phase["limits"]["memoryBytes"])
        self.assertTrue(all(len([member for member in phase["workloads"] if member in
                                ("hupo-chat-prepare", "hupo-chat-owner-bootstrap", "hupo-chat-namespace-secrets")]) <= 1
                            for phase in result["phases"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
