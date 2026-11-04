import json
import ipaddress
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


def document(name):
    path = APP / 'base' / name
    return json.loads(path.read_text()) if path.exists() else None


class TunnelManifests(unittest.TestCase):
    def test_workload_is_one_bounded_nonroot_pod_with_a_verified_immutable_image(self):
        deploy = document('deployment.yaml')
        self.assertIsNotNone(deploy, 'isolated tunnel Deployment is missing')
        self.assertEqual(deploy['metadata']['namespace'], 'hupo-chat')
        self.assertEqual(deploy['spec']['replicas'], 1)
        self.assertEqual(deploy['spec']['strategy'], {'type': 'Recreate'})
        pod = deploy['spec']['template']['spec']
        self.assertEqual(pod['nodeSelector'], {'kubernetes.io/hostname': 'node01'})
        self.assertIs(pod['automountServiceAccountToken'], False)
        self.assertIs(pod['enableServiceLinks'], False)
        self.assertEqual(pod['serviceAccountName'], 'hupo-chat-public')
        self.assertEqual(pod['securityContext'], {
            'runAsNonRoot': True, 'runAsUser': 65532, 'runAsGroup': 65532,
            'seccompProfile': {'type': 'RuntimeDefault'}})
        self.assertEqual(len(pod['containers']), 1)
        container = pod['containers'][0]
        self.assertEqual(container['image'], 'cloudflare/cloudflared:2026.10.7@sha256:4955524aeaa379e154023d5a027c250f7b35041a2e7e950cf13f144bc9b9c5ba')
        self.assertEqual(container['resources'], {
            'requests': {'cpu': '25m', 'memory': '64Mi'},
            'limits': {'cpu': '250m', 'memory': '128Mi'}})
        self.assertEqual(container['securityContext'], {
            'allowPrivilegeEscalation': False, 'readOnlyRootFilesystem': True,
            'capabilities': {'drop': ['ALL']}})
        for field in ['hostNetwork', 'hostPID', 'hostIPC', 'initContainers', 'volumes']:
            self.assertNotIn(field, pod)
        for field in ['env', 'envFrom', 'volumeMounts']:
            self.assertNotIn(field, container)

    def test_origin_and_flags_are_fixed_without_credentials_or_management_diagnostics(self):
        container = document('deployment.yaml')['spec']['template']['spec']['containers'][0]
        self.assertEqual(container.get('args'), [
            'tunnel', '--no-autoupdate', '--protocol', 'http2', '--edge-ip-version', '4',
            '--metrics', '0.0.0.0:20241', '--output', 'json',
            '--management-diagnostics=false',
            '--url', 'http://hupo-chat-web.hupo-chat.svc.cluster.local:3000'])
        self.assertEqual(container.get('ports'), [
            {'name': 'metrics', 'containerPort': 20241, 'protocol': 'TCP'}])
        self.assertEqual(container.get('readinessProbe', {}).get('httpGet'),
                         {'path': '/ready', 'port': 20241})
        self.assertEqual(container.get('livenessProbe', {}).get('httpGet'),
                         {'path': '/healthcheck', 'port': 20241})

    def test_service_is_private_and_account_has_no_tokens_or_rbac(self):
        service = document('service.yaml')
        self.assertIsNotNone(service, 'private metrics Service is missing')
        self.assertEqual(service['metadata']['namespace'], 'hupo-chat')
        self.assertEqual(service['metadata']['name'], 'hupo-chat-public')
        self.assertEqual(service['spec'], {
            'type': 'ClusterIP',
            'selector': {'app.kubernetes.io/name': 'hupo-chat-public'},
            'ports': [{'name': 'metrics', 'port': 20241, 'targetPort': 20241, 'protocol': 'TCP'}]})
        account = document('service-account.yaml')
        self.assertIsNotNone(account)
        self.assertEqual(account['kind'], 'ServiceAccount')
        self.assertEqual(account['metadata']['namespace'], 'hupo-chat')
        self.assertEqual(account['metadata']['name'], 'hupo-chat-public')
        self.assertIs(account['automountServiceAccountToken'], False)
        self.assertNotIn('secrets', account)

    def test_policies_allow_only_web_dns_cloudflare_and_private_preflight_metadata(self):
        policies = document('network-policy.yaml')
        self.assertIsNotNone(policies, 'tunnel isolation policies are missing')
        self.assertEqual(policies['kind'], 'List')
        self.assertEqual(len(policies['items']), 3)
        tunnel, web, preflight = policies['items']
        public_peer = peer('hupo-chat', {'app.kubernetes.io/name': 'hupo-chat-public'})
        preflight_peer = peer('hupo-chat-preflight', {'app.kubernetes.io/name': 'hupo-chat-preflight'})
        web_peer = peer('hupo-chat', {
            'app.kubernetes.io/name': 'hupo-chat', 'app.kubernetes.io/part-of': 'hupo-chat',
            'app.kubernetes.io/component': 'web'})
        self.assertEqual(tunnel['metadata']['namespace'], 'hupo-chat')
        self.assertEqual(tunnel['spec']['podSelector'], public_peer['podSelector'])
        self.assertEqual(tunnel['spec']['policyTypes'], ['Ingress', 'Egress'])
        self.assertEqual(tunnel['spec']['ingress'], [
            {'from': [preflight_peer], 'ports': [{'protocol': 'TCP', 'port': 20241}]}])
        egress = tunnel['spec']['egress']
        self.assertEqual(len(egress), 4)
        self.assertEqual(egress[0], {'to': [peer('kube-system', {'k8s-app': 'kube-dns'})],
                                    'ports': [{'protocol': 'UDP', 'port': 53}, {'protocol': 'TCP', 'port': 53}]})
        self.assertEqual(egress[1], {'to': [web_peer], 'ports': [{'protocol': 'TCP', 'port': 3000}]})
        self.assertEqual(egress[2]['ports'], [{'protocol': 'TCP', 'port': 7844}])
        expected_ips = ['198.41.192.' + end for end in ['167', '67', '57', '107', '27', '7', '227', '47', '37', '77']]
        expected_ips += ['198.41.200.' + end for end in ['13', '193', '33', '233', '53', '63', '113', '73', '43', '23']]
        self.assertEqual(egress[2]['to'], [{'ipBlock': {'cidr': ip + '/32'}} for ip in expected_ips])
        self.assertEqual(egress[3]['ports'], [{'protocol': 'TCP', 'port': 443}])
        self.assertEqual(len(egress[3]['to']), 1)
        internet = egress[3]['to'][0]['ipBlock']
        self.assertEqual(internet['cidr'], '0.0.0.0/0')
        for address in ['0.0.0.0', '10.42.0.1', '10.43.0.1', '100.64.0.1', '127.0.0.1',
                        '169.254.169.254', '172.16.0.1', '192.168.100.191', '192.168.100.229',
                        '198.18.0.1', '224.0.0.1', '255.255.255.255']:
            self.assertTrue(any(ipaddress.ip_address(address) in ipaddress.ip_network(cidr)
                                for cidr in internet['except']), address)
        self.assertEqual(web['metadata']['namespace'], 'hupo-chat')
        self.assertEqual(web['spec'], {
            'podSelector': web_peer['podSelector'], 'policyTypes': ['Ingress'],
            'ingress': [{'from': [public_peer], 'ports': [{'protocol': 'TCP', 'port': 3000}]}]})
        self.assertEqual(preflight['metadata']['namespace'], 'hupo-chat-preflight')
        self.assertEqual(preflight['spec'], {
            'podSelector': preflight_peer['podSelector'], 'policyTypes': ['Egress'],
            'egress': [{'to': [public_peer], 'ports': [{'protocol': 'TCP', 'port': 20241}]}]})

    def test_kustomizations_keep_exact_namespaces_and_have_no_public_router_or_privileged_resources(self):
        base = document('kustomization.yaml')
        self.assertIsNotNone(base, 'base Kustomization is missing')
        self.assertNotIn('namespace', base, 'a namespace transformer would move the private preflight policy')
        self.assertEqual(base['resources'], [
            'service-account.yaml', 'network-policy.yaml', 'service.yaml', 'deployment.yaml'])
        production = APP / 'prod' / 'kustomization.yaml'
        self.assertTrue(production.is_file(), 'production Kustomization is missing')
        self.assertEqual(json.loads(production.read_text()), {
            'apiVersion': 'kustomize.config.k8s.io/v1beta1', 'kind': 'Kustomization',
            'resources': ['../base']})
        allowed_kinds = ['ServiceAccount', 'NetworkPolicy', 'Service', 'Deployment']
        objects = []
        for name in base['resources']:
            item = document(name)
            objects.extend(item['items'] if item['kind'] == 'List' else [item])
        self.assertEqual(len(objects), 6)
        for item in objects:
            self.assertIn(item['kind'], allowed_kinds)
            self.assertIn(item['metadata']['namespace'], ['hupo-chat', 'hupo-chat-preflight'])
        self.assertEqual([item['kind'] for item in objects].count('Deployment'), 1)

    def test_image_provenance_binds_the_official_release_registry_bytes_and_source_commit(self):
        path = APP / 'tests' / 'image-provenance.json'
        self.assertTrue(path.is_file(), 'retrieved image provenance is missing')
        evidence = json.loads(path.read_text())
        image = document('deployment.yaml')['spec']['template']['spec']['containers'][0]['image']
        self.assertEqual(evidence['image'], image)
        self.assertEqual(evidence['registryDigestHeader'], evidence['computedIndexDigest'])
        self.assertTrue(image.endswith('@' + evidence['computedIndexDigest']))
        self.assertEqual(evidence['commit'], evidence['imageSourceCommit'])
        self.assertEqual(evidence['imageSource'], 'https://github.com/cloudflare/cloudflared')
        self.assertEqual(evidence['imageUser'], '65532:65532')
        self.assertEqual(evidence['release']['tag_name'], '2026.10.7')
        self.assertIn('metrics/metrics.go', evidence['sources'])
        self.assertIn('cmd/cloudflared/tunnel/quick_tunnel.go', evidence['sources'])
        self.assertIn('cmd/cloudflared/cliutil/logger.go', evidence['sources'])
        for source in evidence['sources'].values():
            self.assertRegex(source['sha256'], r'^[0-9a-f]{64}$')
            self.assertTrue(source['url'].startswith('https://raw.githubusercontent.com/cloudflare/cloudflared/2026.10.7/'))



def peer(namespace, labels):
    return {'namespaceSelector': {'matchLabels': {'kubernetes.io/metadata.name': namespace}},
            'podSelector': {'matchLabels': labels}}


if __name__ == '__main__':
    unittest.main()
