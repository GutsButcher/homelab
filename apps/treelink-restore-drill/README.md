# treelink-db restore drill (template)

Scratch CNPG cluster that recovers from the treelink-db backups in RustFS. Not
deployed by default. To run a drill, add an Argo Application pointing at this
path (see `docs/BACKUPS.md` in the treelink repo), verify, then remove it again.

`cluster.yaml` currently carries the point-in-time target used on 2026-09-25;
edit `recoveryTarget` (or drop it for a latest-state restore) before reuse.
