---
title: "Kubernetes Core Objects: Pods, ReplicaSets, Deployments, StatefulSets, and Jobs"
slug: k8s-core-objects
category: Kubernetes
tags: kubernetes, k8s, pods, deployments, statefulsets, jobs
excerpt: The objects everything else in Kubernetes is built on — what a Pod actually is, why you almost never create one directly, and how Deployments, StatefulSets, DaemonSets, Jobs, and Namespaces each solve a different problem.
status: published
---

*Post 1 of an 18-part Kubernetes concepts series.* → [Scheduling Workloads](/blog/k8s-workload-scheduling)

Everything else in this series sits on top of these objects. Worth being precise about what each one actually is, because the differences between them are the differences between "my app restarts cleanly" and "my database lost its data."

## Pod — the actual unit of deployment

A Pod is the smallest thing Kubernetes schedules. Not a container — a **Pod**, which is one or more containers that share a network namespace (same IP, same port space, they can reach each other on `localhost`) and can share volumes.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: app
spec:
  containers:
    - name: app
      image: nginx:1.27
      ports:
        - containerPort: 80
```

The critical property: **Pods are mortal and disposable**. A Pod is never healed in place — if the node it's on dies, that Pod is gone forever, and something else has to create a replacement (with a new name and a new IP). That's why you almost never write a bare Pod manifest in production; you write a controller that owns Pods and recreates them for you. The multi-container case has its own established patterns — covered in [Multi-Container Pod Patterns](/blog/k8s-multi-container-patterns).

## ReplicaSet — keeping N copies alive

A ReplicaSet's entire job is: "make sure exactly N Pods matching this selector exist." If one dies, create another. If there are too many, delete some. That's it — no update strategy, no rollout, no history.

You rarely create one directly either, because a Deployment creates and manages ReplicaSets for you. Knowing they exist matters when debugging: `kubectl get rs` showing two ReplicaSets for one app is exactly what an in-progress (or stuck) rollout looks like.

## ReplicationController — the deprecated ancestor

The original version of the ReplicaSet, from before Kubernetes had set-based label selectors. It still technically works, but ReplicaSet superseded it years ago and nothing new should use it. Worth recognizing in old manifests and tutorials, not worth learning in depth.

## Deployment — the one you'll actually use

A Deployment manages ReplicaSets, which manage Pods. That extra layer is what buys you **declarative updates**: change the image tag, and the Deployment creates a new ReplicaSet, scales it up while scaling the old one down, and keeps the old one around at zero replicas so you can roll back.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: app
  template:
    metadata:
      labels:
        app: app
    spec:
      containers:
        - name: app
          image: myapp:1.4.0
```

```bash
kubectl rollout status deployment/app
kubectl rollout undo deployment/app          # back to the previous ReplicaSet
kubectl rollout history deployment/app
```

This is the default for anything stateless — which is most things. How the replacement actually proceeds (rolling vs. recreate, and the blue/green and canary patterns layered on top) is [Deployment Strategies](/blog/k8s-deployment-strategies).

## StatefulSet — when identity matters

A Deployment's Pods are interchangeable: `app-7d9f8b-x2k1`, random suffix, any one is as good as another. A StatefulSet's Pods are not. They get **stable, ordinal names** (`db-0`, `db-1`, `db-2`), stable DNS hostnames, and — critically — **their own PersistentVolumeClaim that follows that specific ordinal** across rescheduling.

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: db
spec:
  serviceName: db          # requires a Headless Service
  replicas: 3
  selector:
    matchLabels: { app: db }
  template:
    metadata:
      labels: { app: db }
    spec:
      containers:
        - name: postgres
          image: postgres:16
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 20Gi
```

Pods are also created and terminated **in order** (0, then 1, then 2; reverse on scale-down), which matters for clustered software that expects a predictable bootstrap sequence. The `volumeClaimTemplates` mechanic is what makes `db-1` come back to *its own* data after being rescheduled — covered further in [Storage](/blog/k8s-storage).

## DaemonSet — one Pod per node

A DaemonSet runs exactly one Pod on every node (or every node matching a selector), and automatically adds one when a node joins the cluster and removes it when a node leaves. This is the right shape for **node-level agents**: log collectors, metrics exporters, CNI plugins, storage drivers.

The tell that something should be a DaemonSet rather than a Deployment: it needs to see *this node's* processes, filesystem, or network — not just "run somewhere in the cluster."

## Job and CronJob — work that finishes

Everything above runs forever. A **Job** runs a Pod until it **completes successfully**, retrying on failure up to `backoffLimit`, and then stops. A **CronJob** creates Jobs on a schedule.

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly-report
spec:
  schedule: "0 2 * * *"
  concurrencyPolicy: Forbid     # don't start if the last one is still running
  jobTemplate:
    spec:
      backoffLimit: 3
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: report
              image: reporting:2.1
```

`concurrencyPolicy: Forbid` is the setting worth knowing about — the default (`Allow`) will happily start a second run while the first is still going, which for a long-running job on a short schedule means overlapping executions nobody planned for.

## Namespace — the boundary everything else scopes to

A Namespace is a virtual cluster inside a cluster — a scope for names (two Pods can both be called `app` in different namespaces) and, more importantly, the boundary that **RBAC, ResourceQuotas, LimitRanges, and NetworkPolicies attach to**.

```bash
kubectl create namespace team-a
kubectl get pods -n team-a
```

Namespaces are the first tool for multi-tenancy, but note they're a *soft* boundary — they scope names and policy, not the kernel or the node. Real isolation needs the quota, network policy, and RBAC layers on top, covered in [Resource Management](/blog/k8s-resource-management) and [Security & RBAC](/blog/k8s-security-rbac).

## On EKS and AKS

All of the above is pure upstream Kubernetes and behaves identically on both — these objects are the portable core, which is exactly the point of learning them at this level. What differs between managed offerings is everything *underneath*: how nodes get provisioned, how storage classes are backed, how identity federates to the cloud's IAM. On EKS that's covered in [EKS Cluster Provisioning & Architecture](/blog/eks-cluster-provisioning-architecture) and [Kubernetes Workloads and Scheduling on EKS](/blog/eks-workloads-scheduling); the AKS equivalents (node pools, Azure Disk/Files CSI, Entra Workload ID) map onto the same object model without changing any manifest above.

---

*Next:* [Scheduling Workloads: Affinity, Taints, and Topology Spread](/blog/k8s-workload-scheduling)
