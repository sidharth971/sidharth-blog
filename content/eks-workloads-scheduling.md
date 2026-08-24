---
title: "Kubernetes Workloads and Scheduling on EKS"
slug: eks-workloads-scheduling
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, workloads, scheduling, affinity, taints, pdb
excerpt: The workload types (Deployments, StatefulSets, DaemonSets, Jobs), and the scheduling controls — affinity, taints/tolerations, topology spread, PodDisruptionBudgets, requests/limits — that determine where and how they actually run.
status: published
---

Every earlier post in this series — networking, load balancing, identity, storage, scaling — ultimately acts on the objects and scheduling rules covered here. This is the layer that decides what runs, and where.

## The workload types

- **Deployment** — stateless, interchangeable replicas. The default choice for anything that doesn't need stable identity or per-replica storage. Rolling updates, easy horizontal scaling (this is what HPA from the [previous post](/blog/eks-compute-scaling-hpa-vpa-karpenter-keda) targets).
- **StatefulSet** — stable per-replica identity and storage, covered in depth in the [Storage post](/blog/eks-storage-ebs-efs-csi-drivers) (`volumeClaimTemplates`). Databases, brokers, anything where replica `N` needs to consistently be the *same* replica across reschedules.
- **DaemonSet** — exactly one pod per node (or per matching subset of nodes), automatically added/removed as nodes join/leave. The right shape for node-level agents — log shippers, the AWS VPC CNI's own `aws-node` pods, a monitoring agent. Not for application workloads.
- **Job** — runs a pod to completion, tracks success, retries on failure. **CronJob** wraps a Job on a schedule. The fit for batch work, migrations, scheduled cleanup — anything that finishes rather than runs forever.

## Affinity and anti-affinity

Node affinity controls *which nodes* a pod can land on (by node labels — instance type, AZ, custom labels from Karpenter's NodePool). Pod affinity/anti-affinity controls placement *relative to other pods*:

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: app
        topologyKey: kubernetes.io/hostname
```

This specific pattern — anti-affinity on your own app label, keyed on hostname — is the classic "don't put two replicas of the same app on the same node" rule, so a single node failure can't take out more than one replica. `requiredDuringScheduling` makes it a hard constraint (the pod won't schedule at all if it can't be satisfied); `preferredDuringScheduling` makes it a soft preference the scheduler tries but won't block on.

## Taints and tolerations

Taints repel pods from a node unless the pod explicitly tolerates them — the inverse of affinity (affinity says "prefer/require going here," taints say "stay away unless you say otherwise"). Common real uses: dedicating a node pool to a specific team or workload (taint the nodes, only that workload's pods carry the toleration), or keeping general workloads off nodes reserved for something specific like GPU jobs.

```yaml
tolerations:
  - key: "dedicated"
    operator: "Equal"
    value: "gpu-workloads"
    effect: "NoSchedule"
```

Karpenter NodePools commonly combine this with node affinity: taint a NodePool's nodes so only pods that explicitly tolerate them land there, keeping expensive/specialized capacity from being silently consumed by unrelated workloads.

## Topology spread constraints

Affinity/anti-affinity answers yes/no questions about specific nodes; **topology spread constraints** answer a distribution question — spread replicas *evenly* across a topology domain (AZ, node, custom label) rather than just avoiding co-location:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: app
```

`maxSkew: 1` means no AZ can have more than one extra replica compared to the least-loaded AZ. This is what actually makes the multi-AZ node groups from the [cluster provisioning post](/blog/eks-cluster-provisioning-architecture) pay off — without it, the scheduler has no reason to avoid clustering all your replicas in a single AZ even when three are available.

## PodDisruptionBudgets

Taints, affinity, and topology spread all control *scheduling*; a **PodDisruptionBudget (PDB)** controls *voluntary disruption* — node drains during cluster upgrades, Karpenter consolidation, `kubectl drain`. It caps how many replicas of a workload can be down at once for these voluntary reasons (it does nothing for involuntary disruption like a node crashing):

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: app-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: app
```

Without a PDB, a rolling node upgrade or a Karpenter consolidation pass can legally evict every replica of a Deployment in quick succession if the scheduler decides it's convenient — a PDB is the guardrail that stops that from actually happening.

## Requests, limits, and QoS

Every container should declare `resources.requests` (what the scheduler reserves capacity for) and, optionally, `resources.limits` (a hard ceiling). The combination determines a pod's **QoS class**:

- **Guaranteed** — requests == limits for every container. Last to be evicted under node pressure.
- **Burstable** — requests set, limits absent or higher than requests. Middle priority.
- **BestEffort** — neither set. First to be evicted under any node pressure.

`ResourceQuota` (namespace-level caps on total resource consumption) and `LimitRange` (default/min/max per-container requests within a namespace) enforce these at the namespace level — useful in a shared cluster where you want to stop one team's namespace from starving another's, independent of what any individual Deployment author remembers to set.

## Priority classes

`PriorityClass` gives pods a priority value the scheduler uses when node resources are contested — higher-priority pending pods can trigger preemption of lower-priority running pods to make room. Reach for this on genuinely critical infrastructure (an Ingress controller, a cluster-critical operator) that should win a resource contention fight against a lower-priority batch job — not as a general-purpose "make my app faster" lever.

## Series wrap so far

That's networking, load balancing, identity, secrets, storage, and scaling/scheduling — the operational core of running real workloads on this cluster. Next up in the series: deployment strategies, observability, security/compliance, and database integrations.
