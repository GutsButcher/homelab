"""Small-trial limits preserve the existing request and retry safety."""
import json
from pathlib import Path
import unittest

BASE = Path(__file__).resolve().parents[1] / 'base'


class TrialSizingTests(unittest.TestCase):
    def test_trial_jobs_have_one_gib_limit_without_spending_requests_or_retries(self):
        for filename, retries in (('prepare.yaml', 2), ('owner-bootstrap.yaml', 0)):
            with self.subTest(filename=filename):
                job = json.loads((BASE / filename).read_text(encoding='utf-8'))
                resource = job['spec']['template']['spec']['containers'][0]['resources']
                self.assertEqual(resource['limits'], {'cpu': '2', 'memory': '1Gi'})
                self.assertEqual(resource['requests'], {'cpu': '250m', 'memory': '768Mi'})
                self.assertEqual(job['spec']['backoffLimit'], retries)
                self.assertEqual(job['spec']['template']['spec']['restartPolicy'], 'Never')


if __name__ == '__main__':
    unittest.main()
