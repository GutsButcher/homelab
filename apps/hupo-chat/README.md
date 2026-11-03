# Isolated Chatwoot server — canonical source

This directory contains the isolated deployment DAG. It does not register an Argo
Application or activate workloads. ERP, CNPG, paused apps, runners and existing public
root paths remain outside its scope. `source-provenance.json` records the first
copied bytes, not an assertion that later manifest edits are unchanged.

## Sync order

Every Job uses the `Sync` hook phase, not `PreSync`.

| Wave | Resources |
| ---: | --- |
| -40 | Namespace `hupo-chat` |
| -39 | Parent-owned production identity SealedSecret |
| -38 | Generator SA, Role, binding, hashed code ConfigMap and Job-only policies |
| -35 | Namespace-secret generator Job |
| -30 | Application SA, config, runtime ConfigMap and application policies |
| -20 | Dedicated PostgreSQL 16/pgvector and Redis Services and StatefulSets |
| -10 | Prepare Job, including the onboarding lock |
| -5 | Guarded owner-bootstrap Job |
| 0 | Uploads PVC, web Service, single web and worker replicas |
| 10 | Production IngressRoute |

The uploads PVC shares its first consumer's wave to avoid a `WaitForFirstConsumer`
deadlock. Successful prepare and owner hooks are deleted. The generator uses
`BeforeHookCreation`. All Jobs have bounded deadlines and TTLs.

## Identity and retained data

Production references the parent's genuine `prod/owner-identity.sealed.json`.
It targets `hupo-chat/hupo-chat-owner-identity` with strict scope at wave `-39`.
There is no plaintext identity, identity template, dummy Secret or generated
credential value in the source. The base renders without this production file.
Its required, read-only identity projection fails closed without the real Secret.
If the parent file is missing, the production render must fail. Never invent ciphertext.

The generator creates only `hupo-chat-secrets` and `hupo-chat-owner-bootstrap`.
Both outputs are immutable, carry `Prune=false,Delete=false`, and share an installation
binding. Valid existing values remain unchanged. If either Secret is missing,
**any** existing declared PVC refuses generation, even a Pending PVC.
Restore original matching credentials with retained data. Never delete data to bypass
the guard. See `base/namespace-secrets/README.md` for partial recovery and cleanup.

After verified owner creation, login and onboarding lock, remove bootstrap Jobs
from desired state before deleting their short-lived inputs or credentials.
Keep `hupo-chat-secrets` with matching database and uploads backups.

## Node, storage and network isolation

All seven application and bootstrap Pods are pinned to `node01`, the P0 filesystem
target. Each dedicated RWO claim explicitly selects `local-path`. The Namespace and claims
carry both prune and delete safeguards. StatefulSet claim retention is explicit.
Web and worker remain single-replica `Recreate` deployments.
Worker keeps its required web affinity. This is not HA. Local-path sizes are not quotas.

The generator copies exactly the approved API rules from
`apps/hupo-chat-preflight/base/network-policy.yaml`:

- `10.43.0.1/32`, TCP 443.
- `192.168.100.191/32` and `192.168.100.229/32`, TCP 6443.

This is a reused bounded allowset, not new endpoint discovery or proof of the actual
post-DNAT peer. The policies select only the generator Job. Existing namespace-wide
DNS access to kube-system remains additive. No application API allowance was added.

The official Android client remains `com.chatwoot.app`, with the upstream push relay.
No custom APK or owner Firebase project is required.

## Phase inputs for the parent P0 check

`phase-budgets.json` records exact requests, limits, PVC bytes and emptyDir bounds.
Tests derive these inputs from the active canonical manifests.

| First-install phase | CPU request | Memory request | Memory limit | emptyDir |
| --- | ---: | ---: | ---: | ---: |
| Generator | 25m | 64Mi | 192Mi | 0Mi |
| PostgreSQL + Redis | 350m | 320Mi | 1536Mi | 272Mi |
| Data + prepare | 600m | 1088Mi | 3584Mi | 912Mi |
| Data + owner bootstrap | 600m | 1088Mi | 3584Mi | 912Mi |
| Steady state | 850m | 1856Mi | 5632Mi | 1552Mi |

Repeat syncs retain existing steady Pods. Generator plus steady state has a 5824Mi
limit. Prepare or owner bootstrap plus steady state has a 7680Mi limit.
The three Jobs occupy separate phases. Do not run them concurrently out of band.
The existing conservative 7.5Gi plan already includes prepare plus steady state.
Its peak requests remain 1100m/2624Mi. Its emptyDir bound remains 2192Mi.
The three PVCs total 42Gi.

The parent must check these phase inputs against P0 without subtracting other apps
or removing reserves. This source integration does not edit the P0 planner or
certify current capacity.

## Offline verification

From this directory, use existing Python and kubectl tools:

```text
python3 -B -m unittest discover -s tests -v
kubectl kustomize --load-restrictor=LoadRestrictionsRootOnly base/namespace-secrets
kubectl kustomize --load-restrictor=LoadRestrictionsRootOnly base
kubectl kustomize --load-restrictor=LoadRestrictionsRootOnly prod
```

Tests cover canonical contracts, DAG, node/storage isolation, exact API peers, RBAC,
guard mutations, phase inputs and hashed ConfigMap references. Source-integrity checks
lock the reviewed Ruby bytes and native regression files. They need no private checkout.
Rendering is not Kubernetes schema or runtime acceptance.

Ruby is unavailable on the authoring host. Native Ruby was not executed during this
integration. Generator and application Ruby sources remain byte-identical to the
reviewed candidate. No package, application or engine was installed or started.
No cluster operation or network probe ran.

The parent owns private CI updates, native acceptance, publication, P0 budget review,
Application registration, explicit sync, rollout checks and real phone verification.
