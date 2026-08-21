# Parked applications

These `Application` manifests are **not** under `argocd/applications/`, so the `root`
app-of-apps does not pick them up and Argo CD does nothing with them. They are kept
here ready to enable — the YAML for each is already correct.

To turn one on:

```bash
git mv argocd/parked/<name>.yaml argocd/applications/apps/<name>.yaml   # or .../infrastructure/
git commit && git push
```

| File | Why it is parked |
| --- | --- |
| `metallb.yaml` | MetalLB is **not installed** in the cluster: `metallb-system` is empty and the MetalLB CRDs are absent. Traefik currently gets its external IPs from k3s' built-in servicelb (`192.168.100.191`, `192.168.100.229`). Enabling this installs MetalLB and starts handing out `192.168.100.210`–`.225`. |
| `traefik.yaml` | Creates the `traefik-metallb` LoadBalancer Service pinned to `192.168.100.210`, plus the Traefik dashboard IngressRoute. Depends on `metallb.yaml`; enabling it without MetalLB leaves the Service `<pending>` forever. Also note the dashboard route references a `authentik-forwardauth` Middleware in the `it-tools` namespace. |
| `it-tools.yaml` | Declared in the old Flux app list but never actually deployed — the `it-tools` namespace does not exist. Enabling it creates the namespace, the deployment and `tools.gwynbliedd.com`. |
| `syncthing.yaml` | Same: declared but never deployed. Note it pins to node `node01` and expects host paths `/storage/syncthing/{config,data}` to exist on that node. |

Not represented here at all: `apps/docmost/` and `apps/old-apps/*`. Those were never in
the Flux app list, and their manifests still contain Flux `HelmRelease` CRs that no
controller in this cluster can act on any more.
