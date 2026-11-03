# Temporary Chatwoot preflight — source only

No Application is registered here. Nothing is deployed by adding this directory.
Do not publish/activate it before independent review. Existing apps, parked apps,
ERP and CNPG are not referenced, mounted, restarted or modified.

## Scope and endpoints

Namespace/service: `hupo-chat-preflight`.
Service origin: `http://hupo-chat-preflight.hupo-chat-preflight.svc.cluster.local:8080`.

| Public host: `n8n.gwynbliedd.com` | Exact service path | Result |
| --- | --- | --- |
| `/.well-known/hupo-chat-preflight` | `/report` | Cached sanitized JSON, HTTP 200 even when `ok:false` |
| `/.well-known/hupo-chat-sealing.pem` | `/certificate` | Valid public PEM, or sanitized HTTP 503 |
| Not public | `/healthz` | HTTP 200 `{"healthy":true}` independently of capacity |

Only GET/HEAD are routed. No root, PathPrefix, public health route, local TLS or
n8n enablement. Middleware rewrites each exact path separately. Unknown service
paths, query strings, encoded variants and trailing slashes return 404; other
methods return 405 internally (unmatched at ingress). HEAD has no body. Requests
only read cache: no request data controls backend URLs, paths, refresh or files.
Responses use `no-store`; external cache behavior must still be checked later.

## Exact public JSON contract

The following is a **contract template, not a real cluster observation**:

```json
{
  "schemaVersion": 1,
  "ok": false,
  "checks": {
    "nodeReady": false,
    "podSlots": false,
    "cpuAllocations": false,
    "cpuUsage": false,
    "memoryRequests": false,
    "memoryUsage": false,
    "disk": false,
    "certificate": false
  },
  "nonce": "<UUID for this attempt>",
  "revision": "<64 lowercase hex characters: planned workload-source SHA-256>",
  "observedNode": null,
  "observedAt": null,
  "ageSeconds": null,
  "fresh": false,
  "error": "NOT_READY"
}
```

No additional report fields. `observedNode` is `node01` after a matching live
observation, otherwise null. `observedAt` is the UTC ISO attempt-start time or
null before the first completed attempt; `ageSeconds` is a nonnegative integer
or null. `nonce` changes per completed/timed-out attempt; it is not a credential.
`revision` identifies the generated budget inputs, not a deployed Git revision.
`ok` requires every check, fresh inputs and no error. `fresh:true` can accompany
a **recent failed attempt**; it does not mean capacity is sufficient.

`error` is null or one of: `NOT_READY`, `API_UNAVAILABLE`, `NODE_UNKNOWN`,
`INPUT_INVALID`, `QUANTITY_INVALID`, `METRICS_UNAVAILABLE`, `METRICS_STALE`,
`DISK_UNAVAILABLE`, `CERT_UNAVAILABLE`, `CERT_INVALID`, `REFRESH_TIMEOUT`,
`REFRESH_FAILED`, `CAPACITY_LOW`, `STALE`. Raw exceptions are never returned.
Endpoint-only error bodies are exactly `{"error":"CERT_UNAVAILABLE"}` (503),
`{"error":"NOT_FOUND"}` (404) or `{"error":"METHOD_NOT_ALLOWED"}` (405).

Refresh is scheduled every 20 seconds, single-flight, with an 8-second overall
and 3.5-second per-request deadline. Snapshot age is limited to 60 seconds and
never outlives the metrics timestamp's 60-second validity. Metrics windows must
be positive and at most 60 seconds; excessive age/future skew fails closed.
Refresh failure immediately replaces previous success. Timed-out uncooperative
work retains the refresh lock until settled; late success cannot overwrite failure.

## Boundaries and budget

- `base/plan.json` and generated `PLAN.md` derive from the actual JSON manifests
  in the canonical sibling `../hupo-chat/base` (`homelab/apps/hupo-chat/base`),
  not a private mirror, for web, worker, postgres, redis, prepare and every declared
  app PVC. Prepare overlaps steady-state workloads conservatively. See `PLAN.md` for exact totals,
  reserves, request/usage comparisons and disk arithmetic; do not hand-edit totals.
- Candidate **node01** is a deliberate documented-worker choice, **not a live
  discovery**. Deployment selector, exact-node RBAC, generator and runtime allowlist
  agree. Changing it requires reviewing all four and the contract tests together;
  never widen node RBAC. A later app must be deliberately pinned to the observed
  node and matching storage filesystem; this component does not change that app.
- Only `statfs('/probe-storage', {bigint:true})` is used for disk. The read-only
  dedicated 1Mi `local-path` PVC shares wave 0 with its consumer, avoiding
  WaitForFirstConsumer deadlock. Namespace/PVC carry `Delete=false,Prune=false`;
  retention is not a backup. Local-path requested sizes are not physical quotas.
- Node usage comes from metrics.k8s.io; allocations include assigned nonterminal
  pods, ordered restartable init sidecars, init maxima, overhead, pod-level requests
  and enacted/in-flight resize resources. Pod pagination is complete or fails
  closed: at most 100 pages, 100 requested items/page, 2MiB/body. Pod specs/env,
  tokens, private IPs and usernames never enter the public report.
- RBAC grants only named-node GET, pod LIST and named-node metrics GET. No API
  writes, secrets/config reads, logs, exec, proxy or wildcard verbs. An explicitly
  projected short-lived token/namespace CA is mounted only in this SA's pod.
  TLS uses that CA, fixed API hostname and hostname verification; no redirects.
- Only the existing **public** certificate is fetched without authorization from
  `http://sealed-secrets-controller.sealed-secrets.svc.cluster.local:8080/v1/cert.pem`.
  It must be a single currently valid RSA X509 certificate, 2048–8192 bits with
  exponent at least 65537. Private/appended PEM content is rejected; output is
  canonical public X509 only. Expiry is checked again when serving. The certificate
  can remain available when capacity fails. No key generation/export or credentials
  escrow exists. Parsing is not a new trust chain or proof of controller identity.
- NetworkPolicy admits Traefik only; egress is CoreDNS, the Kubernetes API's
  explicit service/control-plane addresses, and the fixed controller namespace +
  chart labels/port. Controller namespace/release/labels follow chart **2.16.2** and
  `fullnameOverride: sealed-secrets-controller`. No other app data ports are allowed.
  NetworkPolicy does not replace the fixed HTTP-path code or Kubernetes node/probe
  exceptions. The K3s default API ClusterIP `10.43.0.1` is an **unverified assumption**;
  control-plane endpoint mapping, token audience, labels, CNI enforcement/DNAT,
  PVC placement and filesystem correspondence still require in-cluster verification.
  Failure must not be “fixed” by broad network/RBAC access.

This is a snapshot, not a promise of zero future shared-host impact. Current
working-set metrics, CPU requests and a disk reserve cannot predict future bursts,
images/log growth, scaling, pending workloads, other PVCs or storage paths. The
preflight itself has a small bounded footprint; it does not reserve planned capacity.

## Offline verification (no app/server startup)

From `apps/hupo-chat-preflight`, using an already installed Node:

```sh
node --test --test-concurrency=1 tests/*.test.mjs
kubectl kustomize base > /dev/null
kubectl kustomize prod > /dev/null
kubectl kustomize . > /dev/null
node tools/build-plan.mjs --check
# Explicit source override, when needed:
node tools/build-plan.mjs ../hupo-chat/base --check
```

The default source is the canonical sibling above, resolved relative to
`tools/build-plan.mjs`, not the current working directory. `--check` alone uses
that same source; an explicit source argument overrides it.

Regenerate only after reviewing source-budget changes (writes only this subtree):

```sh
node tools/build-plan.mjs
```

Preferred isolated test runner, with an **explicitly approved disposable Docker
endpoint** (not a production/ambient Docker context). Bind source read-only;
no port publication, network or server startup. On Windows, use a native `C:/...`
source path, not `/c/...`:

```sh
: "${PREFLIGHT_TEST_DOCKER_HOST:?set the approved disposable endpoint}"
docker --host "$PREFLIGHT_TEST_DOCKER_HOST" run --rm --network none --read-only \
  --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges \
  --memory 128m --cpus 1 \
  --mount "type=bind,src=C:/Users/Kaido/work/homelab/apps/hupo-chat-preflight,dst=/work,readonly" \
  --workdir /work \
  node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c \
  node --test --test-concurrency=1
```

Tests use stdlib fixtures and injected transports/server objects: no external
network, live credentials, private keys, disk writes or listening sockets. Public
CA roots bundled with Node are certificate-validation fixtures only, never a
substitute for the real controller certificate. Source/mock tests and local
Kustomize rendering are **not** proof of live capacity, API connectivity, policy
coverage, valid controller certificate, public routing, or successful deployment.
