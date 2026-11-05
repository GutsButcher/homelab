# Generated source budget

Source: `homelab/apps/hupo-chat/base (JSON manifests)`; relevant source SHA-256: `8c34f2a1947c1b3405e7d71b4f9b16d534d33bab3b6ee85a3d2903884b6327a6`.

**Source budget only.** No live capacity result or deployment acceptance is established by generation. All nine reviewed workloads are budgeted concurrently. The selected declared-retry reservation is eleven planned pods for nine workload rows. Older seven-workload evidence does not accept this nine-workload revision; older nine-pod evidence does not accept the new retry policy either. Before auxiliary activation, the exact new preflight source must pass native Node 24 tests, then a fresh matching live snapshot must pass all eight checks. No older snapshot accepts changed source bytes. Main application health remains unobserved by this source check.

| Workload | Planned pod reservation | CPU requests | Memory requests | Memory limits |
| --- | ---: | ---: | ---: | ---: |
| hupo-chat-cluster-verification | 1 | 25m | 64Mi | 192Mi |
| hupo-chat-namespace-secrets | 1 | 25m | 64Mi | 192Mi |
| hupo-chat-owner-bootstrap | 1 | 250m | 768Mi | 1024Mi |
| hupo-chat-postgres | 1 | 250m | 256Mi | 1024Mi |
| hupo-chat-prepare | 3 | 750m | 2304Mi | 3072Mi |
| hupo-chat-public | 1 | 25m | 64Mi | 128Mi |
| hupo-chat-redis | 1 | 100m | 64Mi | 512Mi |
| hupo-chat-web | 1 | 250m | 768Mi | 2048Mi |
| hupo-chat-worker | 1 | 250m | 768Mi | 2048Mi |

Totals: **1925m CPU requests**, **5120Mi memory requests**, **10240Mi memory limits**.

Declared app PVCs: 45097156608 bytes; declared emptyDir bounds: 4311764992 bytes; explicit disk reserve: 10737418240 bytes. Required available bytes on the own local-path PVC filesystem: **60146339840** (56.016 GiB).

CPU reserve: 250m. Memory reserve: 1024Mi. Free-inode reserve: 1024.

- Snapshot candidate: **node01** (documented worker). This is a chosen target, not a live observation; deployment selector, exact-node RBAC and runtime allowlist agree. The public observedNode is populated only after an actual matching API observation.
- Count all seven canonical workloads concurrently, including namespace generation, prepare and owner bootstrap. Sync waves and hook ordering are not phase-exclusive capacity assumptions. No existing workload is subtracted. The runtime pod-slot check counts every replica in the workload rows (11 planned pods).
- The additional verification Job is included as a concurrent row, including its CPU, memory, storage and pod slot; it does not consume the safety reserves. Canonical generation and `--check` automatically include `homelab/apps/hupo-chat-verification/base/job.yaml` when present. An explicit `--additional-job PATH` supports a reviewed source override, not production acceptance.
- The actual public tunnel Deployment is included as a concurrent row, not hidden in reserves. Canonical generation and `--check` also automatically include exactly `homelab/apps/hupo-chat-public/base/deployment.yaml` when present. No tunnel directory scan, basename guess, phase credit or generic cluster-YAML import is used. Copies of the canonical base without auxiliary inputs remain seven-row fixtures with nine planned pods, not auxiliary deployment proof.
- The selected declared-retry reservation is three complete prepare copies (backoffLimit + 1) and one copy of every other workload. All source parallelism/replica guards still require one configured replica. The reviewed prepare source must retain explicit integer backoffLimit=2; it has activeDeadlineSeconds=900 and terminationGracePeriodSeconds=40. CPU, memory, per-copy claims and emptyDirs are scaled for both declared retries on top of every normal workload row. This is not an absolute controller replacement hard cap: retries and terminating/replacement pods may overlap beyond this bounded declared-retry model. Arbitrary external deletions/controller replacement behavior are not bounded here. Any healthy-main/freeze requirement and broader replacement risk remain activation review gates, not phase credits.
- All existing nonterminal pods and actual usage are counted on top of the prospective plan, including existing copies of these workloads; no phase or existing-workload subtraction is allowed. The 1Gi memory and 10Gi disk reserves remain additional requirements, never auxiliary or retry credits.
- Both existing CPU requests and actual CPU usage, plus planned CPU requests and reserve, must fit allocatable CPU. CPU limits may still contend later.
- Existing memory requests plus planned requests and reserve must fit; max(existing requests, actual memory usage) plus all planned memory limits and reserve must also fit.
- Every regular and init container, including restartable init sidecars, must declare an explicit positive memory limit. A zero limit is unbounded, not a zero-byte cap. This fixed seven/eight/nine-workload source policy rejects zero container limits even with a positive pod-level memory cap; CPU and request semantics are unchanged.
- Every declared standalone PVC, per-replica volumeClaimTemplate and generic ephemeral claim template is included, plus positive emptyDir size limits and a separate image/log/growth reserve. Local-path sizes are not filesystem quotas or physical reservations. statfs reads only the dedicated read-only /probe-storage mount; it writes no test files.
- The verification Job declares 16Ki results plus 4Ki owner-envelope memory-backed emptyDirs (20Ki total). These bytes remain within measured memory/limits and are also conservatively charged in the disk bound; they are not excluded by their Memory medium. A retained earlier collector's 16Ki result bound is not a cleanup credit: actual residual memory/storage usage must still be measured until cleanup, regardless of terminal-pod filtering or TTL.
- Exclude only terminal pods and other nodes. Include scheduled Pending/Unknown pods, regular init peaks, ordered restartable-init sidecars, pod overhead, pod-level requests and enacted/in-flight resize allocations.
- Follow local JSON Kustomization resources recursively, not a directory-wide filename scan. Remote references, parent traversal, symlink escapes, cycles, duplicate bindings, unsupported resource kinds and Kustomize transformations fail closed. Reads are bounded to 256 files, 1MiB per file and 8MiB total. Every reviewed workload must retain its kind, one configured replica and node01 selector; deployments must use Recreate. The verifier must explicitly retain namespace hupo-chat, integer parallelism=1, completions=1, backoffLimit=0 and restartPolicy=Never, including explicit overrides. The tunnel must explicitly retain namespace hupo-chat, replicas=1 and no volumes/mounts; auxiliary Jobs cannot introduce PVC/host storage or unbound mounts.
- The revision binds deterministic relative paths and raw Kustomization, workload, PVC and referenced generator-file bytes, plus explicit versioned retry-policy bytes at @planner/retry-policy.json. Additional verification and tunnel resources use separate @verification/job.yaml and @tunnel/deployment.yaml hash paths. Canonical and auxiliary files must remain inside the real repository boundary; resource references also remain inside their selected canonical source tree. Configuration, secret values, environment, identities and raw annotations are never copied into this report.
- Missing inputs, stale metrics, incomplete pod lists or unknown disk counters fail closed. Snapshot success is not a promise of zero future shared-host impact, a storage quota, a backup or deployment authorization.
