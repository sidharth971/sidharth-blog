---
title: "Scheduling Workloads in Kubernetes: Affinity, Taints, nodeSelector, and Topology Spread"
slug: k8s-workload-scheduling
category: Kubernetes
tags: kubernetes, k8s, scheduling, affinity, taints, topology-spread
excerpt: Every mechanism for controlling where a Pod lands — from the blunt nodeSelector to affinity rules, taints and tolerations, static Pods, priority/preemption, and topology spread constraints — and when each is the right tool.
status: published
---

*Post 2 of an 18-part Kubernetes concepts series.* ← [Core Objects](/blog/k8s-core-objects) · → [Multi-Container Patterns](/blog/k8s-multi-container-patterns)

By default the scheduler puts a Pod wherever it fits. That's usually fine, and occasionally catastrophic — all three replicas of your service landing on the same node, GPU workloads scheduled onto expensive nodes reserved for something else, a latency-sensitive app placed three availability zones away from its cache. These are the controls for saying otherwise.

## nodeSelector — the blunt instrument

The simplest possible constraint: the node must have these labels, or the Pod doesn't schedule.

```yaml
spec:
  nodeSelector:
    disktype: ssd
    kubernetes.io/os: linux
```

Exact-match only, AND-ed together, no "prefer," no negation, no alternatives. It's still perfectly reasonable for simple cases — but the moment you need "prefer SSD but accept HDD" or "anything except this zone," you've outgrown it and want node affinity instead.

## Node affinity and anti-affinity

Node affinity is nodeSelector with real expressiveness: set-based operators (`In`, `NotIn`, `Exists`, `Gt`, `Lt`), and — the important part — two enforcement levels:

- `requiredDuringSchedulingIgnoredDuringExecution` — a hard rule. No matching node, no scheduling; the Pod sits `Pending`.
- `preferredDuringSchedulingIgnoredDuringExecution` — a soft preference with a `weight`. The scheduler tries, but places the Pod anyway if nothing matches.

```yaml
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
        - matchExpressions:
            - key: topology.kubernetes.io/zone
              operator: In
              values: ["us-east-1a", "us-east-1b"]
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 80
        preference:
          matchExpressions:
            - key: node.kubernetes.io/instance-type
              operator: In
              values: ["m6i.large"]
```

The `IgnoredDuringExecution` half of those names is doing real work: these rules are evaluated **at scheduling time only**. If a node's labels change afterwards, already-running Pods are not evicted to satisfy the rule.

## Pod affinity and anti-affinity

Node affinity places Pods relative to *nodes*. Pod affinity places them relative to *other Pods* — "put me near the cache" (affinity) or "keep replicas apart" (anti-affinity).

```yaml
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - labelSelector:
          matchLabels:
            app: api
        topologyKey: kubernetes.io/hostname
```

`topologyKey` is the concept that makes this work: it names the node label that defines the "domain" you're spreading across or packing into. `kubernetes.io/hostname` means per-node ("never two `api` Pods on the same node"). `topology.kubernetes.io/zone` means per-AZ. Get the topologyKey wrong and the rule enforces something entirely different from what you meant.

One practical warning: `requiredDuringScheduling` pod anti-affinity on a large cluster is computationally expensive for the scheduler, and it can leave Pods permanently `Pending` if the cluster genuinely can't satisfy it (e.g. 5 replicas, hard per-node anti-affinity, 3 nodes → 2 Pods never schedule). Prefer topology spread constraints (below) for the common "spread my replicas evenly" case.

## Taints and tolerations — the inverse

Affinity is the Pod saying "I want to go there." Taints are the **node** saying "stay off me unless you're explicitly allowed."

```bash
kubectl taint nodes gpu-node-1 workload=gpu:NoSchedule
```

```yaml
tolerations:
  - key: "workload"
    operator: "Equal"
    value: "gpu"
    effect: "NoSchedule"
```

Three effects, and the difference matters:
- `NoSchedule` — new Pods without the toleration won't be scheduled here. Existing Pods stay.
- `PreferNoSchedule` — soft version; the scheduler avoids it if it can.
- `NoExecute` — new Pods won't schedule **and existing Pods without the toleration are evicted**.

Kubernetes uses `NoExecute` taints itself for node problems (`node.kubernetes.io/not-ready`, `unreachable`) — which is the mechanism behind Pods being evicted off a failing node. A toleration doesn't *attract* a Pod to a tainted node, it only permits it; pair taints with node affinity when you want dedicated nodes that are also actually *used* by the intended workload.

## nodeName — bypassing the scheduler

Setting `nodeName` directly skips the scheduler entirely and pins the Pod to a named node:

```yaml
spec:
  nodeName: worker-3
```

If that node doesn't exist or has no room, the Pod just fails — no rescheduling, no fallback. This is a debugging and bootstrapping tool, not a production placement strategy.

## Static Pods

A **static Pod** is managed directly by the **kubelet** on a specific node, from manifest files on that node's disk (typically `/etc/kubernetes/manifests/`), with no API server involvement in creating it. The kubelet watches that directory and keeps those Pods running, and creates a read-only "mirror Pod" in the API so you can *see* them with `kubectl` — but you can't manage them that way.

This is how control plane components bootstrap on a self-managed cluster: the API server itself runs as a static Pod, which neatly solves the chicken-and-egg problem of needing an API server to schedule the API server. Covered further in [Cluster Architecture](/blog/k8s-cluster-architecture).

## Priority and preemption

A `PriorityClass` assigns Pods a numeric priority. When a high-priority Pod can't schedule for lack of resources, the scheduler may **preempt** — evict lower-priority Pods to make room.

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: critical
value: 1000000
globalDefault: false
description: "Cluster-critical components"
```

Use it for genuinely critical infrastructure (ingress controllers, monitoring agents) that must win a resource fight against batch work. Don't hand it out broadly — if everything is high priority, nothing is, and you've just added eviction churn. Preemption respects PodDisruptionBudgets on a best-effort basis, which is covered in [Scheduling & Eviction](/blog/k8s-scheduling-eviction).

## Topology spread constraints

The purpose-built answer to "distribute my replicas evenly," which pod anti-affinity only approximates awkwardly:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: api
```

`maxSkew: 1` means the most-loaded zone may have at most one more matching Pod than the least-loaded. `whenUnsatisfiable` chooses between `DoNotSchedule` (hard) and `ScheduleAnyway` (soft, best-effort).

This is what actually makes multi-zone node pools pay off. Without it, nothing stops the scheduler from putting all replicas in one zone — the capacity is spread, but your Pods aren't, and an AZ outage takes the whole service down anyway.

## On EKS and AKS

Every mechanism above is upstream Kubernetes and works identically on both. What differs is the **node labels** you're matching against and how nodes appear in the first place:

- Both clouds set the standard well-known labels (`topology.kubernetes.io/zone`, `node.kubernetes.io/instance-type`, `kubernetes.io/os`), so zone-spreading and instance-type affinity rules are portable as written.
- Node provisioning differs but has converged: EKS uses **Karpenter** (NodePools with requirements and taints), and AKS's **Node Auto Provisioning is also Karpenter-based** (Azure provider) — so the pattern of "taint a provisioned node pool, add matching tolerations to the workloads allowed on it" reads nearly the same on both.
- AWS-specific scheduling detail (Karpenter NodePool requirements, consolidation interacting with PDBs) is in [Kubernetes Workloads and Scheduling on EKS](/blog/eks-workloads-scheduling) and [Autoscaling on EKS](/blog/eks-compute-scaling-hpa-vpa-karpenter-keda).

---

*Next:* [Multi-Container Pod Patterns](/blog/k8s-multi-container-patterns)
