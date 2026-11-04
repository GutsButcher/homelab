# Generated source budget

Source: `homelab/apps/hupo-chat/base (JSON manifests)`; relevant source SHA-256: `e8909a962f275e21148ac2674862b6da51e4616ac8170107d8e11e60d1159523`.

**Source budget only.** No live capacity result or deployment acceptance is established by generation. An older five-workload snapshot does not accept this revision; promote the matching preflight source and obtain a fresh runtime snapshot.

| Workload | Concurrent replicas | CPU requests | Memory requests | Memory limits |
| --- | ---: | ---: | ---: | ---: |
| hupo-chat-namespace-secrets | 1 | 25m | 64Mi | 192Mi |
| hupo-chat-owner-bootstrap | 1 | 250m | 768Mi | 2048Mi |
| hupo-chat-postgres | 1 | 250m | 256Mi | 1024Mi |
| hupo-chat-prepare | 1 | 250m | 768Mi | 2048Mi |
| hupo-chat-redis | 1 | 100m | 64Mi | 512Mi |
| hupo-chat-web | 1 | 250m | 768Mi | 2048Mi |
| hupo-chat-worker | 1 | 250m | 768Mi | 2048Mi |

Totals: **1375m CPU requests**, **3456Mi memory requests**, **9920Mi memory limits**.

Declared app PVCs: 45097156608 bytes; declared emptyDir bounds: 2969567232 bytes; explicit disk reserve: 10737418240 bytes. Required available bytes on the own local-path PVC filesystem: **58804142080** (54.766 GiB).

CPU reserve: 250m. Memory reserve: 1024Mi. Free-inode reserve: 1024.

- Snapshot candidate: **node01** (documented worker). This is a chosen target, not a live observation; deployment selector, exact-node RBAC and runtime allowlist agree. The public observedNode is populated only after an actual matching API observation.
- Count all seven canonical workloads concurrently, including namespace generation, prepare and owner bootstrap. Sync waves and hook ordering are not phase-exclusive capacity assumptions. No existing workload is subtracted. The runtime pod-slot check counts every replica in the workload rows (7 planned pods).
- **Verification job is not included.** Materialize the public verification Job, regenerate this plan and refresh runtime evidence before using it for deployment. The 1Gi reserve does not prove verification CPU or pod-slot headroom. Canonical generation and `--check` automatically include `homelab/apps/hupo-chat-verification/base/job.yaml` when present. An explicit `--additional-job PATH` supports a reviewed source override, not production acceptance.
- Both existing CPU requests and actual CPU usage, plus planned CPU requests and reserve, must fit allocatable CPU. CPU limits may still contend later.
- Existing memory requests plus planned requests and reserve must fit; max(existing requests, actual memory usage) plus all planned memory limits and reserve must also fit.
- Every regular and init container, including restartable init sidecars, must declare an explicit positive memory limit. A zero limit is unbounded, not a zero-byte cap. This fixed seven/eight-workload source policy rejects zero container limits even with a positive pod-level memory cap; CPU and request semantics are unchanged.
- Every declared standalone PVC, per-replica volumeClaimTemplate and generic ephemeral claim template is included, plus positive emptyDir size limits and a separate image/log/growth reserve. Local-path sizes are not filesystem quotas or physical reservations. statfs reads only the dedicated read-only /probe-storage mount; it writes no test files.
- Exclude only terminal pods and other nodes. Include scheduled Pending/Unknown pods, regular init peaks, ordered restartable-init sidecars, pod overhead, pod-level requests and enacted/in-flight resize allocations.
- Follow local JSON Kustomization resources recursively, not a directory-wide filename scan. Remote references, parent traversal, symlink escapes, cycles, duplicate bindings, unsupported resource kinds and Kustomize transformations fail closed. Reads are bounded to 256 files, 1MiB per file and 8MiB total. Every reviewed workload must retain its kind, one concurrent replica and node01 selector; deployments must use Recreate.
- The revision binds deterministic relative paths and raw Kustomization, workload, PVC and referenced generator-file bytes. The additional verification Job uses a separate hash path. Configuration, secret values, environment, identities and raw annotations are never copied into this report.
- Missing inputs, stale metrics, incomplete pod lists or unknown disk counters fail closed. Snapshot success is not a promise of zero future shared-host impact, a storage quota, a backup or deployment authorization.
