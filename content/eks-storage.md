---
title: "Persistent Storage on EKS: EBS and EFS CSI Drivers, StorageClasses, and Backups"
slug: eks-storage-ebs-efs-csi-drivers
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, storage, ebs, efs, csi-driver, velero
excerpt: EBS vs EFS for Kubernetes storage, how StorageClasses and dynamic provisioning actually connect a PVC to a real volume, StatefulSet-specific storage patterns, and backing it all up with Velero.
status: published
---

Compute and networking are covered earlier in this series; this post is about the third leg — what happens when a pod needs storage that survives longer than the pod itself.

## EBS vs. EFS: the fundamental fork

Two CSI drivers, two entirely different storage models, and picking the wrong one is a design mistake you'll feel immediately:

- **EBS CSI driver** — block storage, **ReadWriteOnce (RWO)**: one volume attaches to one node at a time. This is what a database pod wants — low-latency block storage, but it means the volume follows the pod to wherever it's scheduled and can't be shared across nodes simultaneously.
- **EFS CSI driver** — a managed NFS filesystem, **ReadWriteMany (RWX)**: many pods, on many nodes, mounting the same filesystem concurrently. Higher latency than EBS, but it's the only one of the two that supports genuine concurrent multi-pod access — shared config, shared upload directories, ML training data read by many workers at once.

If a workload needs one pod to own its volume exclusively, reach for EBS. If multiple pods need to read or write the *same* files at the *same* time, EBS can't do that at all — it has to be EFS (or an object-storage pattern via S3, which sidesteps the filesystem question entirely).

## StorageClass and dynamic provisioning

A `StorageClass` is a template that tells Kubernetes how to provision a volume on demand when a `PersistentVolumeClaim` (PVC) asks for one — instead of a human pre-creating EBS volumes and hoping the sizes line up, the CSI driver creates exactly what's requested, when it's requested:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ebs-gp3
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
```

`volumeBindingMode: WaitForFirstConsumer` matters more than it looks: it delays actually provisioning the EBS volume until a pod using the PVC is scheduled, so the volume gets created in the *same AZ* as the node — get this wrong (`Immediate` binding) and you can end up with a volume in one AZ and a pod scheduled in another, which simply fails to mount, since EBS volumes are AZ-local.

## PV, PVC, and reclaim policy

The three-layer model: a `PersistentVolume` (PV) is the actual provisioned storage; a `PersistentVolumeClaim` (PVC) is a pod's request for storage matching certain criteria (size, access mode, class); Kubernetes binds the two. With dynamic provisioning, you almost never hand-write a PV — the StorageClass's provisioner creates one automatically to satisfy each PVC.

`reclaimPolicy` decides what happens to the underlying EBS volume when the PVC is deleted:
- **Delete** (the default for dynamically provisioned volumes) — the EBS volume is destroyed along with the PVC. Fine for ephemeral/reproducible data, dangerous for anything that isn't backed up elsewhere.
- **Retain** — the volume survives PVC deletion, becomes "released," and has to be manually cleaned up or re-bound. Safer default for anything holding data you can't regenerate — worth overriding explicitly on a StorageClass backing a database.

## StatefulSets and volumeClaimTemplates

A `Deployment`'s pods are interchangeable; a `StatefulSet`'s aren't — each replica gets its own stable identity and, critically, its **own PVC** that follows that specific replica across rescheduling. That's what `volumeClaimTemplates` does: instead of one shared PVC, the StatefulSet stamps out a PVC per replica (`data-myapp-0`, `data-myapp-1`, …), and replica `myapp-1` always comes back to the *same* volume even after being rescheduled to a different node.

```yaml
volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: ebs-gp3
      resources:
        requests:
          storage: 20Gi
```

This is the mechanism that makes running something like a database or a Kafka broker directly on Kubernetes viable at all — without it, every rescheduled replica would come up with empty, brand-new storage.

## Snapshots and backups: Velero

None of the above is a backup strategy — `reclaimPolicy: Retain` prevents *accidental* deletion, not disaster recovery. **Velero** is the standard tool for actual EKS backup/restore: it snapshots both Kubernetes object state (Deployments, Services, PVC definitions) and, via a volume snapshotter plugin, the underlying EBS volumes themselves, and can restore either into the same cluster or a completely different one.

```bash
velero backup create daily-backup --include-namespaces sidhu-ns --ttl 720h
velero restore create --from-backup daily-backup
```

Worth having on any cluster running stateful workloads, even a small one — "recreate everything from Terraform/Helm" handles the infrastructure, but it doesn't bring back the *data* that was inside a PVC, and that's specifically what Velero is for.

## Next up

[Compute Scaling](/blog/eks-compute-scaling-hpa-vpa-karpenter-keda) — HPA, VPA, Cluster Autoscaler, Karpenter, and KEDA, and how they actually differ.
