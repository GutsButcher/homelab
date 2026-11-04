# Verification and owner-access courier: INERT source resource

`base/job.yaml` is a complete **Job resource for budgeting and future integration**, not
an activated or runnable deployment bundle. It preserves the reviewed collector's
core fields, resources and mounts, with an explicit process-limit/realpath command
wrapper, and adds the second encryption init container, courier code/envelope
volumes and publication-before-reporting wrapper. No Application, namespace, ServiceAccount,
RBAC, network policy, Kustomization, token or SealedSecret is created here.
No ConfigMap data, source-SHA placeholder or recipient key is supplied. The canonical
main application's manifests and runtime are unchanged.

## Execution and isolation contract

The fixed Job is `hupo-chat-cluster-verification` in namespace `hupo-chat`, pinned to
`node01` and the same immutable application image as the collector. It retains
parallelism/completions 1, backoff limit 0, active deadline 300 seconds, TTL 600 seconds,
Sync hook wave 30 and `BeforeHookCreation` deletion policy. All processes inherit
nonroot UID/GID 1000, RuntimeDefault seccomp, read-only root filesystem, dropped
capabilities and no privilege escalation. HOME is `/nonexistent`; RUBYOPT/RUBYLIB are
empty. No credentials are passed in environment variables or command arguments.

All three command arrays first call
`Process.setrlimit(Process::RLIMIT_NPROC, 64, 64)` before launching their realpath
Ruby entrypoints. This is a Linux kernel **per-UID** process bound, not a cgroup
PID guarantee. A failure to install the limit aborts startup; it is not waived.

1. **`collect` init:** realpath-execs the original collector with exactly
   `--run-in-cluster`; its mounts are unchanged. Only this container receives the
   short-lived Kubernetes API projection. It writes `/results/report.json`.
2. **`encrypt-owner-access` init:** invokes the actual ConfigMap Ruby file through
   `File.realpath`, with exactly `--run-in-cluster`. It reads the validated report,
   reporter library/source binding, two-file run binding, public recipient data and
   only `OWNER_EMAIL`/`OWNER_PASSWORD` from the existing owner Secret. It writes only
   the new envelope memory volume. It has no reporting token or API projection.
3. **`report` container:** runs courier publication first, then unconditionally
   `exec`s the original argument-free reporter from the Ruby `ensure` block after
   the process limit has been installed. Both
   Ruby paths use `File.realpath`. A publisher false/nonzero result does not bypass
   `ensure`; an ordinary Ruby exception emits only the fixed failure marker before
   proceeding to the reporter. It mounts only reporter code, report token, results,
   owner public code/data and the read-only envelope. It has no plaintext owner
   credentials, separate run-binding mount or API/service-account projection.

The original reporter's four deployment checks and six-field result are unchanged.
Courier delivery is a separate mandatory owner-local gate, never deployment proof.
A valid negative collector report allows the courier to skip and the reporter to run;
a failing init container still prevents regular-container startup. The wrapper does
not promise recovery from process termination, Pod deletion or a failed reporter exec.
The full owner-code ConfigMap is mounted read-only in the publisher; only its public
fingerprint is read by publication, not the recipient PEM or any private key.

## Referenced inputs are deliberately absent

Parent integration must first finish and verify the **actual new private bound
revision**: the collector's 50 native tests and courier's 44 native tests (41 existing
courier tests plus three command-wrapper regressions), including
any outstanding source corrections. Existing/older pass reports do not accept new
bytes. Only then may the parent materialize matching public ConfigMaps:

- `hupo-chat-cluster-verify-code`: the complete accepted collector source bundle.
- `hupo-chat-verification-code`: the unchanged accepted `result.rb`, `github_client.rb`,
  `reporter.rb` and exact bound `source_sha`.
- `hupo-chat-owner-access-code`: exactly `wire.rb`, `encrypt.rb`, `publish.rb`, the
  owner's actual ephemeral RSA-4096/65537 **public** `recipient.pem`, and its exact
  public-DER `recipient_sha256`. No private key belongs in Git, CI or the cluster.

The resource also requires the reviewed dedicated ServiceAccount/RBAC/network policy,
`kube-root-ca.crt`, existing `hupo-chat-owner-bootstrap`, and the future correctly
bound `hupo-chat-verification-token` Secret. Binding mounts project only
`source_sha`/`nonce`; the separate report-token mount also projects `token`.
All required references are nonoptional. No stub ConfigMaps or fabricated 40-hex
source identity are used to make this resource appear runnable. This directory is
not included in the canonical main Kustomization and has no Argo Application.
Do not claim a complete rendered auxiliary bundle before those real inputs exist.

## Exact prospective budget, not live acceptance

The preflight builder automatically reads the fixed public Job and
`apps/hupo-chat-public/base/deployment.yaml` when generating the canonical plan.
It budgets all seven canonical workloads **plus both actual auxiliaries concurrently**:

- Verification Pod: 25m CPU/64Mi memory requests; 192Mi memory limit. The serial
  25m/64Mi-limit encryptor does not raise the collector/reporter's 192Mi Pod peak.
- Tunnel: one Recreate Pod, 25m CPU/64Mi requests, 128Mi memory limit; no volumes/PVCs.
- The selected declared-retry reservation is **eleven planned pods for nine workload
  rows**: three prepare copies and one of every other workload. All source
  parallelism/replicas remain one. Prepare's explicit integer `backoffLimit=2`
  reserves its initial copy plus both declared retries, not just a sensitivity.
- All eleven reservations: **1925m CPU requests, 5120Mi memory requests,
  14336Mi memory limits**. Both extra prepare copies include their complete
  CPU/memory and 640Mi of emptyDirs each.
- Verification memory-backed emptyDirs: 16Ki results + 4Ki envelope = **20Ki**.
  The generic planner also charges all 20Ki to disk conservatively; it does not
  silently drop memory-backed volumes. No new PVC is introduced.
- Available bytes required by declared PVCs + all emptyDirs + the separate 10Gi
  disk reserve: **60146339840**. CPU reserve 250m, memory reserve 1Gi and inode
  reserve 1024 remain additional requirements, not auxiliary or retry credits.

Every current scheduled nonterminal Pod, its resource allocations and actual node
usage are counted **on top of** this prospective plan. Existing copies are not
subtracted. Retained terminal collector results can still occupy their 16Ki memory
bound until cleanup; terminal-Pod exclusion and TTL are not memory/storage credits.

This selected bounded declared-retry reservation is **not an absolute replacement
hard cap**. The unchanged canonical prepare Job has backoffLimit=2,
activeDeadlineSeconds=900 and terminationGracePeriodSeconds=40. Terminating/replacement
Pods may overlap beyond the declared-retry model; arbitrary external deletions and
controller behavior are not universally bounded. Any healthy-main/freeze requirement
and broader replacement risks remain explicit activation review gates, not phase credits.
The revision now includes versioned `@planner/retry-policy.json` bytes as well as
the exact raw workload inputs; changing the algorithm cannot reuse a nine-pod report.
Canonical copies without auxiliaries have seven rows and nine planned slots, not
acceptance for this nine-workload/eleven-pod revision.
Main application health has not been established by this source work.

## Source verification and remaining gates

From the public repository root, using the **existing** host runtime only:

```text
node --test apps/hupo-chat-preflight/tests/plan.test.mjs apps/hupo-chat-preflight/tests/plan-source.test.mjs
node apps/hupo-chat-preflight/tools/build-plan.mjs --check
```

These are source/metadata checks on Node 22, not native Node 24 acceptance. The new
exact revision must pass native Node 24 tests and receive a fresh matching live P0
snapshot with **all eight checks** passing before auxiliary activation. Older
seven-row evidence, the old conditional seven-Pod phase proof and the previous
native suite and the earlier nine-pod plan do not accept this selected eleven-pod
revision. The two fixed auxiliary read-only native CI mounts must be separately
source-reviewed and published before testing this exact new public revision.

**UNRUN:** the new exact-image 44-test courier/wrapper suite and actual kernel-limit
verification for all three ConfigMap-linked commands, including publication success,
false/nonzero exit, ordinary exception and argument-free reporter continuation
process doubles. The three arrays match the fixed source command contract locally;
source configuration is not proof of executed Ruby behavior or limit enforcement.

**The 64-PID policy is installed by the explicit NPROC wrapper, but is not enforced
as a cgroup PID limit.** No unsupported Pod `pidsLimit` or RuntimeClass is invented.
Other processes sharing UID 1000 can already exhaust this kernel per-UID limit;
that must be an honest native failure, not a silent fallback. Parent must verify
the exact immutable image/source under this limit before treating the courier as
runtime-ready. Source-only host tests do not enforce or certify it.

No host Docker/WSL, installs, application services, Git operations, cluster writes,
activation, code ConfigMap generation, token issuance or owner-key operations are
part of this source handoff.
