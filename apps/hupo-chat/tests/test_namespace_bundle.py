"""Run the bundle's contracts through the canonical test entry point."""

from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[1]
BundleTests = runpy.run_path(str(ROOT / "base/namespace-secrets/tests/check_bundle.py"))["BundleTests"]
