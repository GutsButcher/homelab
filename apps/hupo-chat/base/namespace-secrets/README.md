# Namespace-secret bootstrap — canonical bundle

The canonical base includes this self-contained bundle. Inclusion does not create
an Application or activate workloads. This source integration makes no runtime success
claim. ERP, CNPG, paused apps and runners are outside its scope.

## Components

- `generate.rb`: explicit `--run-in-cluster` command and create-or-adopt orchestration.
- `secret_policy.rb`: owner input, exact managed-object policy and independent entropy.
- `kubernetes_api.rb`: fixed named API operations and bounded verified HTTPS transport.
- `kustomization.yaml`: local code ConfigMap plus dedicated SA, Role, binding, policies
  and a bounded Sync-hook Job. It contains no Secret object or secret value.
- `tests/`: offline Ruby behavior tests with injected in-memory transports and Python
  source/manifest contracts. Neither suite contacts a cluster.

The adaptation follows the owner's ERP create-only pattern, not its broad
"any GET failure means missing" behavior. Only a matching, well-formed Kubernetes
404 Status is absence. Authorization failures, redirects, malformed JSON, duplicate
JSON keys, oversized bodies and unexpected objects refuse the run.

The API hostname is fixed to `kubernetes.default.svc.cluster.local:443`. The client
uses the projected CA, peer and hostname verification, TLS 1.2 minimum, no ambient
proxy, no URL input, no redirects and no HTTP retries. Connect/read/write timeouts
are 2/3/3 seconds; each request has an 8-second deadline. The command has a
120-second deadline, and the Job has a separate 180-second deadline. Bodies are
bounded at 64 KiB. Tokens are bounded, reread from the projection, and never logged.
Only fixed messages reach stdout/stderr; raw exception causes are suppressed.

## Required owner input — not generated here

The parent supplies the genuine production SealedSecret at wave `-39`. The owner
must verify the actual email. It produces the separate **read-only** Secret
`hupo-chat-owner-identity` in `hupo-chat`. This bundle contains neither an email nor
an identity Secret template. Do not send its values through Git, CI, command-line
arguments, environment variables or logs.

Required keys: `OWNER_EMAIL`, `OWNER_EMAIL_VERIFIED` (exactly `true`). Optional key:
`OWNER_NAME`. No other input keys are accepted. No owner identity is invented. A
single terminal newline is removed from mounted files, matching the canonical
file-input behavior; email is stripped/lowercased, and an optional name is stripped.
Name omission is preserved; the application handles its own default display name.
Reads pin one projected-volume revision to avoid mixed input during a refresh.
Input is validated before any API operation; missing input prevents the Job from
mounting or causes a fixed refusal, never Secret creation.

The generator does not have API `get` permission for the identity Secret. Kubelet
mounts it. There is no Firebase, SMTP, external secret broker or token handoff.

## Stable values, ownership and partial recovery

`hupo-chat-secrets` contains exactly the contract's six required runtime keys.
Postgres and Redis passwords are independent 48-character lowercase hexadecimal
values. `SECRET_KEY_BASE` is 128 hexadecimal characters; each encryption key and
salt is an independent 32-character hexadecimal value. These are a versioned
bootstrap policy, not a migration policy for arbitrary preexisting Secrets.

`hupo-chat-owner-bootstrap` contains the verified input identity and a separate
256-bit random password with a four-character class suffix. It meets the canonical
bootstrap's length/upper/lower/digit/symbol rules. Optional name is copied only
when supplied. Generated values exist only in process memory, TLS request bodies
and the Kubernetes Secrets; this script writes no plaintext files.

Both outputs are immutable Opaque Secrets with the fixed managed-by/part-of labels,
`namespace-secrets-v1` schema, `Prune=false,Delete=false`, no owner references and a
shared random installation binding. They outlive the Job's TTL. Existing objects
must satisfy exact keysets, canonical Base64, value rules, metadata and the current
owner input. Unknown/foreign objects are not adopted, patched or overwritten.
There is no update, patch, delete, list or watch operation.

State handling:

1. Both valid Secrets exist with the same binding: retain all values exactly.
2. Either is missing: GET each of these exact canonical PVC names before entropy
   generation and again before every create:
   `data-hupo-chat-postgres-0`, `data-hupo-chat-redis-0`, `hupo-chat-uploads`.
   Any existing PVC refuses the run, even if Pending or believed empty.
3. Both are missing and all PVC reads are matching 404s: mint runtime values and a
   random binding first, then owner credentials under the accepted runtime binding.
4. One valid Secret survives and no declared PVC exists: preserve the survivor
   byte-for-byte and mint **only** the missing Secret, reusing its binding. This
   recovers an interrupted first run without overwriting surviving key values.
5. A POST 409 gets at most three named readbacks, validates the winner and adopts
   it only under the pairing rules. A runtime-first race may establish the binding;
   an existing owner or runtime pins it. A 201 also gets readback, and its data and
   binding must match the submitted object. POSTs are never retried blindly.
6. Final named reads validate unchanged data, binding and object UID. All other
   cases stop. An API failure after a successful create may leave one valid Secret;
   the next explicitly authorized run follows the same recovery rules.

The guard is not a transaction with PVC creation. Integration must keep all data
consumers/PVC creation in later waves and exclude concurrent out-of-band provisioning.
If a PVC appears between creates, the next guard stops. Do not delete retained data
to bypass the guard. Missing credentials with retained data require a separately
reviewed restore of the original matching Secrets, not newly generated credentials.

## Integrated order, privileges and network

The Namespace is wave `-40`. Production identity follows at `-39`.
Scaffolding, policies and code are `-38`. The generator Sync Job is `-35`.
Application config/policies follow at `-30`, PostgreSQL/Redis at `-20`, prepare at
`-10`, owner bootstrap at `-5`, and uploads/web/worker at `0`.
Kustomize must resolve the code ConfigMap hash in standalone and combined renders.

All Pods are pinned to `node01`. The generator requests 25m/64Mi and limits
250m/192Mi. Owner bootstrap requests 250m/768Mi and limits 2 CPU/2Gi.
They occupy separate phases. `../../phase-budgets.json` records exact first-install
and repeat-sync inputs. The existing conservative 7.5Gi peak remains unchanged.
These inputs do not certify live capacity or remove the parent's P0 review.

API egress reuses the approved bounded P0 allowset from
`apps/hupo-chat-preflight/base/network-policy.yaml`:

- `10.43.0.1/32`, TCP 443.
- `192.168.100.191/32` and `192.168.100.229/32`, TCP 6443.

This is not new endpoint discovery or proof of which peer the CNI sees after DNAT.
There is no broad API namespace, subnet, private range or `0.0.0.0/0` allowance.
The token projection requests 600 seconds with audience
`https://kubernetes.default.svc.cluster.local`. The server can issue a different lifetime.
This source does not claim an observed token lifetime.

Kubernetes RBAC cannot restrict Secret `create` by `resourceNames`.
This Role grants namespace-only create, named GET for two output Secrets, and named
GET for three PVCs. Code restricts creates to the two fixed names.
The identity Secret has no API GET grant. Remove this privilege after verified bootstrap.

These policies select **only** the namespace-secrets Job label, not application
Pods. Existing Kubernetes NetworkPolicies are additive: the canonical namespace-
wide DNS policy also permits port 53 to kube-system. This bundle does not tighten
that inherited permission or widen application Pod access. Audit any other
inherited policies and CNI-specific host-network exceptions before claiming exact
on-wire isolation; the new policies alone cannot revoke existing allowances.

## Cleanup after verified application-owner bootstrap

After separately verifying database preparation, successful owner creation, login
and onboarding lock, first remove both bootstrap Jobs from **desired state** so a future sync
does not recreate it. Remove its SA, RoleBinding, Role, generated code ConfigMap,
and its two Job-only NetworkPolicies. Remove the identity Secret from its separate
production desired source and delete that live input under authorized procedures.
Delete the short-lived `hupo-chat-owner-bootstrap` only after verified success;
this generator deliberately has no cleanup permission. Do not leave a desired
owner-bootstrap Job that still depends on the deleted Secret.

**Retain `hupo-chat-secrets` long term with matching database/uploads backups.**
Never rotate/delete it as Job cleanup. Deleting either output after PVC creation
and rerunning this hook is intentionally refused. No runtime password rotation,
owner password recovery or retained-data repair is implemented here.

## Genuine offline verification

From this directory, existing Python can run:

```text
python3 -B tests/check_bundle.py
```

That suite reads the active canonical manifests. PVC names derive from the
StatefulSets and uploads claim. Runtime keys derive from the actual canonical
entrypoint. It needs no private checkout or copied contract. It does not parse or
execute Ruby and is not a Kubernetes schema or live authorization test.
The canonical app also runs these contracts through `tests/test_namespace_bundle.py`.

The existing kubectl client can render this standalone bundle entirely offline:

```text
kubectl kustomize --load-restrictor=LoadRestrictionsRootOnly .
```

The standalone renderer returns seven resources without a Secret or Namespace.
The combined base contains 26 resources. Production contains 28, including the
parent-supplied SealedSecret. All resolve the same hashed code ConfigMap.
Renders are not schema, authorization or runtime acceptance results.

In the parent-controlled pinned-image native CI, without a running application:

```text
ruby -c generate.rb
ruby -c secret_policy.rb
ruby -c kubernetes_api.rb
ruby tests/run.rb
```

The Ruby suite uses only stdlib plus an in-memory test harness. It constructs
synthetic reserved-domain identity fixtures in memory, injects all API/TLS traffic
and performs no sockets, subprocesses, secret-file writes or API operations. TLS
failure tests inject errors; they do not claim a real handshake. It covers strict
absence/error distinctions, foreign/invalid objects, identity, preserved idempotence,
PVC guards, partial recovery, create races, body bounds and fixed log messages.

**Ruby is unavailable on the authoring host. Native commands were not executed during this integration.**
The three generator sources and five native test files remain byte-identical to
the reviewed candidate. Canonical source-integrity tests record their hashes.
No Ruby runtime, package, container engine or host component was installed or
started. No cluster or network probe was performed. Native acceptance and
schema/CNI/in-cluster checks remain parent integration requirements.
