# Generated snapshot budget

Source: `homelab/apps/hupo-chat/base (JSON manifests)`; relevant source SHA-256: `e167e12f3f22570bc01823273972886116ed00643fea63b945cb7e420e391330`.

| Workload | Concurrent replicas | CPU requests | Memory requests | Memory limits |
| --- | ---: | ---: | ---: | ---: |
| hupo-chat-postgres | 1 | 250m | 256Mi | 1024Mi |
| hupo-chat-prepare | 1 | 250m | 768Mi | 2048Mi |
| hupo-chat-redis | 1 | 100m | 64Mi | 512Mi |
| hupo-chat-web | 1 | 250m | 768Mi | 2048Mi |
| hupo-chat-worker | 1 | 250m | 768Mi | 2048Mi |

Totals: **1100m CPU requests**, **2624Mi memory requests**, **7680Mi memory limits**.

Declared app PVCs: 45097156608 bytes; declared emptyDir bounds: 2298478592 bytes; explicit disk reserve: 10737418240 bytes. Required available bytes on the own local-path PVC filesystem: **58133053440** (54.141 GiB).

CPU reserve: 250m. Memory reserve: 1024Mi. Free-inode reserve: 1024.

- Snapshot candidate: **node01** (documented worker). This is a chosen target, not a live observation; deployment selector, exact-node RBAC and runtime allowlist agree. The public observedNode is populated only after an actual matching API observation.
- Count prepare concurrently with every steady-state workload, even though migration normally precedes web/worker. No existing workload is subtracted.
- Both existing CPU requests and actual CPU usage, plus planned CPU requests and reserve, must fit allocatable CPU. CPU limits may still contend later.
- Existing memory requests plus planned requests and reserve must fit; max(existing requests, actual memory usage) plus all planned memory limits and reserve must also fit.
- Every declared standalone PVC and per-replica volumeClaimTemplate is included, plus emptyDir size limits and a separate image/log/growth reserve. Local-path sizes are not filesystem quotas or physical reservations. statfs reads only the dedicated read-only /probe-storage mount; it writes no test files.
- Exclude only terminal pods and other nodes. Include scheduled Pending/Unknown pods, regular init peaks, ordered restartable-init sidecars, pod overhead, pod-level requests and enacted/in-flight resize allocations.
- Missing inputs, stale metrics, incomplete pod lists or unknown disk counters fail closed. Snapshot success is not a promise of zero future shared-host impact, a storage quota, a backup or deployment authorization.
