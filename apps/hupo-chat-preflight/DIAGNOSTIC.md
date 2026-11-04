# Observation-only state diagnostic v1

This source adds hints, not admission. It does not select a phase budget or prove application availability.
`phaseAdmissionVerified` is always `false`. All existing eight report checks, errors, freshness rules and full-policy decisions remain mandatory.
The selected plan still reserves eleven pod slots for nine workload rows. No plan bytes or reserves change.

## Header contract

Only exact `/report` GET and HEAD can carry `X-Hupo-State-Diagnostic`.
The value is unpadded base64url of one ASCII JSON record, at most 2048 encoded bytes.
It adds no JSON body fields. Existing certificate, public-URL and security headers keep their existing scope.
Query strings, other routes and rejected methods cannot read or refresh the observer.

This is a field template, not a cluster observation:

```json
{
  "schemaVersion": 1,
  "producerSha256": "<64 lowercase hex characters>",
  "policyRevision": "<same revision as the report>",
  "nonce": "<same nonce as the report>",
  "observedAt": "<same observedAt as the report>",
  "observedNode": "<same observedNode as the report, including null>",
  "capacity": {"state": "UNKNOWN", "fullPolicyDeficitMi": null},
  "application": {
    "state": "UNKNOWN",
    "identityMatches": null,
    "reportedHealthy": null,
    "syncedExpected": null,
    "idle": null,
    "reason": "UNAVAILABLE"
  },
  "phaseAdmissionVerified": false
}
```

No other fields are allowed. Unknown values are null, not fabricated negative observations.
A client must match the expected producer digest, policy revision, nonce, time and node against the same fresh report.
A matching digest identifies public source bytes. It is not a signature, live owner receipt or future freeze proof.
Do not use this header to override a failed report, activate an auxiliary workload or spend any reserve.

The header is absent before the first completed observation, after refresh failure or timeout, and when the report is stale.
A new failed mandatory observation replaces its old hints. It cannot retain a prior deficit or Application status.
If only Argo observation fails, a fresh report can still carry a known memory deficit and unknown Application status.
If Argo freshness expires first, only the Application hint becomes `UNKNOWN` with reason `STALE`.

## Full-policy memory deficit

The runtime uses the existing exact integer resource accounting:

```text
required = max(existingAllocatedRequests, observedWorkingSet)
           + selectedFullPlanMemoryLimits + existingMemoryReserve
fullPolicyDeficitMi = ceil(max(0, required - nodeAllocatableMemory) / 1048576)
```

This is the same conservative comparison used by `checks.memoryUsage`.
One byte above the boundary reports 1 MiB. At the boundary, the deficit is zero.
Enacted allocations, resize accounting, init containers, sidecars and overhead keep their existing rules.
Invalid node, metrics, allocations or policy inputs produce `UNKNOWN` and null.
An estimate outside the safe integer range also produces `UNKNOWN`.
Only the rounded deficit leaves this calculation. Raw RAM, requests, working-set values and pod names never enter the header.
A zero deficit is only an observation. It does not reserve capacity or predict future demand.

## Narrow Argo observation

The runtime reads only:

```text
GET /apis/argoproj.io/v1alpha1/namespaces/argocd/applications/hupo-chat
```

It uses the existing verified Kubernetes API origin, mounted CA and projected ServiceAccount identity.
It has no direct Argo API origin, redirect, anonymous fallback, caller-selected path or application-resource access.
Each optional observation has a 256 KiB body limit, 8 KiB header limit and 750 ms total budget.
The monotonic deadline covers token/CA preparation, transport and semantic projection without renewal.
Absolute completion checks reject late success even if a timer callback is delayed. Synchronous stalls are not preemptible.
Expired or aborted subscribers cannot start HTTP after raw preparation settles. Pending raw token/CA reads remain coalesced across refreshes, including when one peer fails.

Two GETs bracket the mandatory observation. Both must qualify and have identical UID, resourceVersion and relevant identity/state fingerprints.
The fingerprint covers source/destination, health/sync state, reconciliation time and pending/last operation state.
Annotations, messages, resource details, URLs and error text are not public projections.

The fixed identity is:

- Application `argocd/hupo-chat`, kind `Application`, API version `argoproj.io/v1alpha1`, project `homelab`.
- Repository `https://github.com/GutsButcher/homelab.git`, path `apps/hupo-chat/prod`.
- Immutable revision `4b88cf5f984404cf0539811127dbe66cfd38c18a`.
- Destination `https://kubernetes.default.svc`, namespace `hupo-chat`.

The source and destination must contain exactly these literal fields. Multi-source or extra rendering configuration is not accepted.
Any present `spec.sourceHydrator` override is unsupported and produces UNKNOWN with null observations, including null or malformed overrides.
A deleting Application also produces unknown status rather than reusing its reported health.
`status.sync.comparedTo` must match this same source and destination.
`status.sync.status`, `status.health.status` and operation phases must use their accepted enums.
Sync revisions must be full lowercase 40-character Git hashes.
`Synced` at another hash or `OutOfSync` produces a qualified `syncedExpected:false` hint, not a passing admission result.
Present operation request/result revisions must match the fixed pin. Missing or malformed operation details produce unknown status.
Pending operations and `Running` or `Terminating` operation phases set `idle:false`.
A completed historical operation can be old. Its valid start/finish timestamps must remain ordered.

The reconciliation timestamp must be a valid UTC timestamp no older than 60 seconds, with at most five seconds of future skew.
Other accepted operation timestamps cannot be in the future beyond that skew.
No Application `observedGeneration` field is assumed or invented.
`reportedHealthy:true` means only Argo reports `Healthy` for this qualified snapshot.
It does not prove full rollout, login, cleanup, core resource health, owner handoff, future quiescence or enforceable availability constraints.

The fixed reason enum is:

| State | Reason | Meaning |
| --- | --- | --- |
| KNOWN | `OBSERVED` | Qualified Argo Healthy, expected sync and no pending/active operation |
| KNOWN | `BUSY` | Pending operation or Running/Terminating phase |
| KNOWN | `REPORTED_UNHEALTHY` | Argo reports Progressing, Degraded, Missing or Suspended |
| KNOWN | `NOT_SYNCED` | Argo reports OutOfSync or a different valid sync revision |
| UNKNOWN | `DENIED` | API 401 or 403 |
| UNKNOWN | `MISSING` | API 404, not Argo's qualified Missing health status |
| UNKNOWN | `STALE` | Invalid freshness or expired Argo hint |
| UNKNOWN | `MALFORMED` | Invalid structure, enum, timestamp, JSON or response bound |
| UNKNOWN | `CHANGING` | Bracket UID/resourceVersion/relevant state changed |
| UNKNOWN | `IDENTITY_MISMATCH` | Wrong identity, compared source/destination or operation pin |
| UNKNOWN | `STATUS_UNKNOWN` | Argo explicitly reports Unknown health or sync |
| UNKNOWN | `UNAVAILABLE` | Transport/credentials failure, redirect, skipped read or unavailable observer |

Known reason priority is BUSY, then REPORTED_UNHEALTHY, then NOT_SYNCED, then OBSERVED.
No optional failure changes a mandatory capacity/certificate check or becomes a main-application incident.

## Shared refresh bound

The existing single-flight refresh keeps its eight-second deadline and abort signal for all mandatory and optional work.
The optional observer does not start a new observation with less than 800 ms left in that same budget.
This leaves at most 750 ms for preparation, transport and projection, plus 50 ms to publish completed mandatory inputs.
HTTP starts only while the original optional budget and publication reserve remain valid; preparation does not renew either deadline.
A skipped second read produces unknown Application status rather than spending the final mandatory refresh budget.
Absolute completion-time checks also reject success after the attempt deadline if a timer callback runs late.
Timeout clears the cached diagnostic immediately. The cache lock stays held until the active observation settles.
Unsettled raw optional preparation retains its own coalescing gate across refreshes; optional expiry never aborts the shared mandatory signal.
Late success cannot replace timeout or a newer snapshot. Public callers never trigger reads.
The existing tunnel metadata discovery retains its separate bounds and behavior.

## Producer byte fingerprint

`base/runtime/producer.mjs` has one explicit, ordered allowlist:

```text
application.mjs capacity.mjs certificate.mjs diagnostic.mjs endpoint.mjs plan.json
producer.mjs public-endpoint.mjs resources.mjs server.mjs snapshot.mjs upstream.mjs
```

Kustomize projects these basenames into the existing source ConfigMap. Only three runtime files are added to that projection.
Startup hashes and loads the plan from the same fixed module/version directory.
It does not discover directories, accept caller paths or read environment/credential files for the digest.
Each regular file is bounded at 64 KiB. Reads reject missing, linked/escaped, nonregular, changed or oversized files.
The existing ConfigMap-linked entrypoint resolves to the immutable version directory before loading these regular files.
The digest is computed at startup, not stored as a self-referential expected hash.

To compute the expected SHA-256 independently from the immutable public packet:

1. Start with ASCII bytes `hupo-state-producer-v1` followed by one NUL byte.
2. For each basename above, append its ASCII name, NUL, decimal raw byte length, then NUL.
3. Append that file's exact bytes, then one NUL byte.
4. Hash the complete stream with SHA-256 and encode it as lowercase hex.

`plan.json` maps to `base/plan.json` in Git. Each other name maps to `base/runtime/<name>`.
Use the exact immutable ConfigMap/Git bytes. Do not normalize JSON, line endings or whitespace.
Windows checkout bytes can differ from Linux/Git packet bytes. The parent must derive the expected digest from its selected immutable packet.

## Inert read permission and remaining gates

`state-reader-access/` renders only a Role and RoleBinding named `hupo-chat-preflight-state-reader` in the existing `argocd` namespace.
Its only rule is `get` on `argoproj.io/applications`, `resourceNames: [hupo-chat]`.
Its subject is the existing `hupo-chat-preflight` ServiceAccount in namespace `hupo-chat-preflight`.
It creates no Namespace, Application or workload. It adds no list/watch, mutation, proxy or application-resource permissions.
The existing ClusterRole and certificate-reader grant are unchanged.

This directory is not referenced by base, prod, the root Kustomization or an Application change in this implementation.
The checked-in `homelab` AppProject already permits this repository, the `argocd` destination namespace and these namespaced RBAC kinds.
That source check does not prove the live AppProject or grant is active. Do not widen the project to work around a denial.
A 403 before activation is normal and remains an unknown diagnostic hint.

The parent must independently review source, run exact-image Node 24 tests and verify the ConfigMap-linked startup smoke.
Only then can the parent add a third immutable P0 Application source and promote all three P0 sources together.
No activation file, main Application, selected policy, verifier, tunnel or owner handoff changes belong to this tracer.
A later promotion may replace the existing Recreate P0 pod through normal verified GitOps. It must not add a diagnostic workload.
Fresh live capacity, public header routing, actual Argo state and any future admission prerequisites remain unverified gates.
