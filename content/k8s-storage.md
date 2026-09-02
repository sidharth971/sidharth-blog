---
title: "Kubernetes Storage: Volumes, PV/PVC, StorageClasses, Access Modes, and CSI"
slug: k8s-storage
category: Kubernetes
tags: kubernetes, k8s, storage, persistent-volumes, csi, storageclass
excerpt: From emptyDir to dynamically provisioned CSI volumes — the PV/PVC split and why it exists, what access modes actually restrict (RWO limits a node, not a Pod), reclaim policies, and the volumeClaimTemplates mechanic behind StatefulSets.
status: published
---

*Post 6 of an 18-part Kubernetes concepts series.* ← [Configuration](/blog/k8s-configuration) · → [Resource Management](/blog/k8s-resource-management)

Containers have ephemeral filesystems — everything written inside a container is gone when it restarts. Volumes fix that, but "volume" in Kubernetes covers several very different things, from a scratch directory that dies with the Pod to a cloud disk that outlives the entire cluster.

## Volume — the general concept

A volume is a directory mounted into a container, defined at the **Pod** level and mounted per-container. Its lifetime is tied to whatever backs it, and that's where the types diverge sharply.

Note the shared-volume property from [Multi-Container Patterns](/blog/k8s-multi-container-patterns): two containers in the same Pod mounting the same volume see the same files, which is how sidecars read the main container's output.

## emptyDir — scratch space, dies with the Pod

Created empty when the Pod is assigned to a node, deleted permanently when the Pod is removed.

```yaml
volumes:
  - name: cache
    emptyDir: {}
  - name: fast-scratch
    emptyDir:
      medium: Memory        # tmpfs — RAM-backed, counts against memory limits
      sizeLimit: 256Mi
```

Good for scratch files, caches, and passing data between containers in a Pod. Note that `medium: Memory` is a tmpfs — fast, but it consumes the Pod's memory allocation, so it can get you OOMKilled if unbounded.

Container **restarts** don't clear an emptyDir; only Pod deletion does.

## hostPath — a path on the node (usually a mistake)

Mounts a file or directory from the **node's** filesystem into the Pod.

```yaml
volumes:
  - name: docker-sock
    hostPath:
      path: /var/run/containerd/containerd.sock
      type: Socket
```

Legitimate uses are node-level agents that genuinely need node access — a log collector reading `/var/log`, a monitoring agent reading `/proc` — i.e. DaemonSets.

For application workloads it's the wrong tool and a real security problem: the Pod escapes its isolation boundary and can read/write node files, and a writable hostPath mount is a well-known privilege-escalation path. The `restricted` Pod Security Standard blocks it outright ([Security & RBAC](/blog/k8s-security-rbac)). It's also not portable — the data is stranded on one node, so a rescheduled Pod finds an empty or wrong directory.

## PersistentVolume and PersistentVolumeClaim

The core abstraction, and the split confuses people until you see the intent: it separates **what storage exists** from **what a workload asks for**.

- **PersistentVolume (PV)** — a cluster resource representing actual storage (a cloud disk, an NFS export). Not namespaced.
- **PersistentVolumeClaim (PVC)** — a namespaced *request*: "I need 20Gi, ReadWriteOnce, from this StorageClass." Kubernetes binds it to a suitable PV.

Pods reference the PVC, never the PV directly:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: standard
  resources:
    requests:
      storage: 20Gi
---
# in the Pod spec
volumes:
  - name: data
    persistentVolumeClaim:
      claimName: data
```

The point of the indirection: application manifests stay portable. The same PVC works on any cluster that has a matching StorageClass, whether that's EBS, Azure Disk, or NFS in a homelab.

## StorageClass, dynamic and static provisioning

**Static provisioning** is an admin creating PVs by hand ahead of time, and PVCs binding to whatever pre-existing PV fits. It works, but someone has to predict sizes in advance and unused PVs sit there wasting capacity.

**Dynamic provisioning** is the norm: a **StorageClass** names a provisioner and parameters, and a PVC referencing it causes a PV to be **created on demand**.

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
allowVolumeExpansion: true
```

Two fields carry more weight than they look:

**`volumeBindingMode: WaitForFirstConsumer`** delays creating the volume until a Pod using the PVC is actually scheduled — so the volume is created in the *same zone* as the node that will use it. With the default `Immediate` binding, you can get a volume in `us-east-1a` and a Pod scheduled in `us-east-1b`, which simply never mounts, because zonal block storage is zone-local. This is one of the most common "my Pod is stuck in ContainerCreating forever" causes.

**`allowVolumeExpansion: true`** lets you grow a PVC later by editing its requested size. Without it, resizing means creating a new volume and migrating data.

A cluster usually has a **default** StorageClass (annotated `storageclass.kubernetes.io/is-default-class: "true"`) used by PVCs that don't name one.

## Access modes

What the volume permits, and the nuance that trips people up:

- **ReadWriteOnce (RWO)** — mountable read-write by **one node**. Not one Pod — multiple Pods *on the same node* can share it. This surprises people who assume RWO means exclusive Pod access.
- **ReadOnlyMany (ROX)** — read-only by many nodes.
- **ReadWriteMany (RWX)** — read-write by many nodes simultaneously. Requires a shared filesystem (NFS, EFS, Azure Files); block storage like EBS or Azure Disk **cannot** do this.
- **ReadWriteOncePod (RWOP)** — read-write by exactly **one Pod**, cluster-wide. GA since Kubernetes 1.29, CSI-only. This is the one to use when an application genuinely cannot tolerate a second writer — a database that would corrupt itself if two instances opened the same files.

The access mode is a *request that the backing storage must support*, not something Kubernetes can grant on its own. Asking for RWX against a block-storage StorageClass fails; you need a file-storage class.

## Reclaim policy

What happens to the underlying storage when the PVC is deleted:

- **Delete** (default for dynamically provisioned volumes) — the real disk is destroyed with the PVC. Fine for reproducible data, dangerous for anything you can't regenerate.
- **Retain** — the PV survives, moves to `Released`, and needs manual cleanup or re-binding. The safer choice for databases and anything holding real data.
- **Recycle** — deprecated, ignore it.

For anything stateful, set `reclaimPolicy: Retain` on the StorageClass deliberately. The default protects nobody from an accidental `kubectl delete pvc`.

## volumeClaimTemplates

A Deployment's replicas would all share one PVC, which is wrong for stateful workloads. **StatefulSets** solve it with `volumeClaimTemplates` — a PVC template stamped out **per replica**:

```yaml
volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: fast
      resources:
        requests:
          storage: 50Gi
```

This creates `data-db-0`, `data-db-1`, `data-db-2`, and — the essential part — replica `db-1` always reattaches to `data-db-1` when rescheduled, even onto a different node. That stable identity-to-storage binding is what makes running databases on Kubernetes viable at all ([Core Objects](/blog/k8s-core-objects)).

One sharp edge: **deleting a StatefulSet does not delete its PVCs.** That's deliberate (it protects your data), but it means storage lingers and keeps costing money until explicitly cleaned up.

## CSI drivers

The **Container Storage Interface** is the plugin standard that lets storage vendors integrate without code in Kubernetes itself. Every in-tree cloud storage plugin has been migrated out to CSI — which is why storage on a modern cluster means installing a driver (as a DaemonSet plus a controller Deployment) rather than relying on built-in support.

Beyond basic provisioning, CSI is also what enables snapshots (`VolumeSnapshot`), volume expansion, and topology awareness.

## On EKS and AKS

Storage is where the two clouds map most cleanly onto each other, because both expose the same block-vs-file split:

| | EKS | AKS |
|---|---|---|
| Block (RWO) | EBS CSI driver | Azure Disk CSI driver |
| Shared file (RWX) | EFS CSI driver | Azure Files CSI driver |
| Object-ish | Mountpoint for S3 CSI | Azure Blob CSI driver |

The decision logic is identical on both: if one Pod owns the volume, use block; if many Pods must write the same files concurrently, block *cannot* do it and you need the file offering. Both install their drivers as managed add-ons, and both need `WaitForFirstConsumer` for zonal block storage for the same reason.

The AWS specifics — EBS vs EFS trade-offs, StorageClass parameters, Velero for backup/restore — are in [Persistent Storage on EKS](/blog/eks-storage-ebs-efs-csi-drivers).

---

*Next:* [Resource Management: Requests, Limits, Quotas, and QoS](/blog/k8s-resource-management)
