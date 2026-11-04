# Hupo Chat: temporary public HTTPS tunnel

**Source only; not activated.** This accountless Quick Tunnel is a temporary test endpoint, not a stable production domain. The hostname changes when the tunnel is recreated; stopping the process ends access. Cloudflare gives no uptime guarantee, limits each tunnel to 200 in-flight requests, and does not support SSE. This is not a promise of 200 concurrent chat users.[12]

## Image and exact-source provenance

The Deployment pins:

```text
cloudflare/cloudflared:2026.10.7@sha256:4955524aeaa379e154023d5a027c250f7b35041a2e7e950cf13f144bc9b9c5ba
```

The official release was published on October 30, 2026. The Docker Hub manifest-list response digest matched the SHA-256 computed over its exact response bytes. Its Linux/amd64 manifest is `sha256:32f933aa6fe1f69c5885b93f3c92cc3f60cca8f0530868bc3bc2cc446114a385`; the index also contains Linux/arm64.[1][6]

`tests/image-provenance.json` records the retrieved metadata, source-file hashes, tag object, and peeled commit `872b241f94871665c1c157adefcf90c11f0ead96`. The registry image configuration reports the same `CI_GIT_COMMIT`, official source repository, UID/GID `65532:65532`, and `cloudflared` entrypoint. This is a source/registry metadata cross-check, not an independent build attestation or proof that the image was executed.

Compatibility was checked against **tag 2026.10.7**, not `master`:

- `metrics/metrics.go:82-84` registers `/quicktunnel` and emits one `hostname` field.[2]
- `cmd/cloudflared/tunnel/quick_tunnel.go:217-230` preserves an explicitly selected transport and passes the provisioned hostname to the server. `cmd.go:509-515` supplies it to the metrics handler.[3][4]
- The tag supports `--protocol http2`, `--edge-ip-version 4`, `--metrics`, `--no-autoupdate`, and `--management-diagnostics=false`. JSON logging uses **`--output json`**, not a guessed `--logformat` flag.[4][5][9]
- The fixed provisioning service is `https://api.trycloudflare.com`; accountless mode does not supply `--allowed-mail`, account credentials, or a tunnel token.[3][4]

The public documentation fetch returned HTTP 403. Its official `cloudflare/cloudflare-docs` source was retrieved instead; no browser/account workaround was used.

## Isolation and resource bounds

`base` and `prod` contain one single-replica `Recreate` Deployment on `node01` in the existing `hupo-chat` namespace. Requests are `25m` CPU / `64Mi`; limits are `250m` CPU / `128Mi`. The dedicated ServiceAccount has no RBAC bindings or mounted token. The pod is non-root, drops all capabilities, uses `RuntimeDefault` seccomp and a read-only root filesystem, and mounts no Secret, host path, persistent storage, or writable volume. The writable-filesystem and resource limits still require native image verification.

The only configured origin is:

```text
http://hupo-chat-web.hupo-chat.svc.cluster.local:3000
```

The policies select exact namespace/pod labels and permit:

- Tunnel ingress: only the existing `hupo-chat-preflight` pod on TCP `20241`.
- Tunnel egress: cluster DNS on TCP/UDP `53`; only the owned web pod on TCP `3000`; the documented Cloudflare tunnel IPv4 addresses on TCP `7844`; public IPv4 HTTPS on TCP `443` for provisioning. HTTP/2 is forced, so UDP `7844` is not allowed.[10][11]
- Web ingress: only the tunnel pod on TCP `3000`.
- Preflight discovery egress: only the tunnel pod on TCP `20241`.

The public `443` rule excludes private, loopback, link-local/metadata, CGNAT, benchmark, documentation, multicast and reserved address ranges. Standard NetworkPolicy is not an FQDN filter; this rule permits public HTTPS rather than only one public hostname. No private ERP/n8n application peer is allowed, and the origin cannot be selected by callers. Verify CNI enforcement, service DNAT behavior and the union with any other policies before activation.

The metrics Service is `ClusterIP` only. There is no Ingress/IngressRoute, NodePort, public metrics/debug/log route, log exporter, log-reading permission, or generic HTTP/API proxy. Cloudflared logs remain private container logs. `--management-diagnostics=false` disables diagnostic management access; the metrics listener itself must remain private.[4]

The new public app owns three policies, including a **separate additive egress policy in `hupo-chat-preflight`**. This leaves the preflight's existing API/certificate network policy and its regression contract unchanged. The Kustomizations deliberately omit a namespace transformer so this cross-namespace policy remains in its exact namespace. Neither namespace is created, changed or owned here.

## Optional discovery header, not an identity assertion

The actual preflight entrypoint creates an independent `PublicEndpointDiscovery`. Its existing 20-second refresh tick starts optional discovery without awaiting it or joining the capacity/certificate observation budget. Report requests only read its cache; they never open sockets.

The client uses Node's direct HTTP transport with `agent: false`, not ambient proxy configuration. Its destination is fixed:

```text
http://hupo-chat-public.hupo-chat.svc.cluster.local:20241/quicktunnel
```

It has one absolute `750ms` deadline covering DNS, headers and body, a `1024`-byte header parser limit and a `1024`-byte streamed body cap, and one coalesced in-flight request. It never follows redirects, requests another path, forwards caller headers/credentials, decompresses a response, or reads logs. A successful response must be status `200` and one literal JSON `hostname` field containing a bare lowercase ASCII DNS hostname beneath `.trycloudflare.com`; schemes, ports, paths, escapes, extra/duplicate fields, invalid labels and CR/LF are rejected. Hints expire after 25 seconds, are discarded on failed/invalid observations, and are not served while their observation timestamp is in the future.

Only the existing report route's `200` GET/HEAD response can include:

```text
X-Hupo-Chat-Public-URL: https://<validated-hostname>
```

Missing, stale, invalid or failed discovery omits the header without failing the report. The report JSON/schema and eight checks, GET/HEAD body behavior, no-store headers, root 404 behavior, and certificate route/source marker are unchanged. No third public route was added. Certificate retrieval remains the existing authenticated Kubernetes API service-proxy provider; this feature introduces no certificate trust claim or new API privileges.

The header is **only a discovery hint**. Before using an observed value, the deployment owner must independently verify its public HTTPS certificate/hostname and the expected Chatwoot `/api` response without redirecting to another host. Do not treat a mocked test hostname, log line, or the header alone as deployment evidence.

## Activation gates and operational handoff

No account, billing, DNS, existing public root route, Argo Application, live source pin, paused application, cluster object or Docker daemon was changed by this source work. No real public URL was created or claimed.

Before activation, the deployment owner must:

1. Include this actual Deployment's additional pod and resource requests in the reviewed capacity plan. Keep the current live code pin unchanged until native gates pass.
2. Run the pinned cloudflared image in an isolated native/container test with these exact flags, UID, read-only filesystem and bounds; verify readiness, provisioning and tunnel egress. Run preflight tests and its real ConfigMap-linked entrypoint in the pinned Node image. Unit mocks are not those gates.
3. Review the namespace permissions and additive policies, render both overlays, and only then register/pin the new app through the existing publication workflow. No registration is included here.
4. Read the optional header from the **existing** preflight report route and independently verify the actual public HTTPS `/api` response. Missing/invalid hints must not trigger a logs endpoint or broader RBAC fallback.
5. Set Chatwoot `FRONTEND_URL` to that **observed and independently verified** HTTPS URL and roll its web and worker Deployments through the existing owner workflow. No automatic configuration writer, restart manager or cron was added.

Repeat the URL verification and `FRONTEND_URL`/rollout step after tunnel recreation. Use a proper stable production domain and managed tunnel before relying on stable URLs, production availability or SSE.[12]

## Source-only verification

From the homelab repository root:

```sh
node --test apps/hupo-chat-preflight/tests/*.test.mjs
python3 -B -m unittest discover -s apps/hupo-chat-public/tests -v
kubectl kustomize apps/hupo-chat-public/base
kubectl kustomize apps/hupo-chat-public/prod
kubectl kustomize apps/hupo-chat-preflight/base
kubectl kustomize apps/hupo-chat-preflight/prod
```

`kubectl kustomize` is an offline renderer here, not a cluster command. The new client/header tests use in-memory transport/server doubles and never start a host application or provision a tunnel. The manifest suite uses only Python's standard library. Provenance tests check the stored retrieval record against the checked-in pin; they do not claim a new online or native image verification each time they run.

TDD covered the missing client, hostname/schema validation, status/redirect handling, byte cap, failure/deadline/coalescing, freshness, optional header and runtime/generator wiring with observed RED-to-GREEN runs. Manifest TDD covered workload bounds, fixed flags/origin, Service/ServiceAccount, network policy, overlays and provenance. Native images, real TLS/API behavior, CNI enforcement, actual readiness and capacity remain **unrun** by this source-only task.

## Sources

[1] https://github.com/cloudflare/cloudflared/releases/tag/2026.10.7
[2] https://raw.githubusercontent.com/cloudflare/cloudflared/2026.10.7/metrics/metrics.go
[3] https://raw.githubusercontent.com/cloudflare/cloudflared/2026.10.7/cmd/cloudflared/tunnel/quick_tunnel.go
[4] https://raw.githubusercontent.com/cloudflare/cloudflared/2026.10.7/cmd/cloudflared/tunnel/cmd.go
[5] https://raw.githubusercontent.com/cloudflare/cloudflared/2026.10.7/cmd/cloudflared/flags/flags.go
[6] https://registry-1.docker.io/v2/cloudflare/cloudflared/manifests/2026.10.7
[9] https://raw.githubusercontent.com/cloudflare/cloudflared/2026.10.7/cmd/cloudflared/cliutil/logger.go
[10] https://raw.githubusercontent.com/cloudflare/cloudflared/2026.10.7/connection/protocol.go
[11] https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/partials/cloudflare-one/tunnel/firewall/required-ports.mdx
[12] https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/tunnel/get-started/quick-tunnels/index.mdx
