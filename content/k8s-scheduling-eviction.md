---
title: "The Scheduler, Eviction, Node Pressure, PodDisruptionBudgets, and Draining Nodes"
slug: k8s-scheduling-eviction
category: Kubernetes
tags: kubernetes, k8s, eviction, pdb, cordon, drain, node-pressure
excerpt: The two completely different kinds of eviction — and why a PodDisruptionBudget protects you from one but not the other. Plus node-pressure thresholds, cordon vs drain, and the PDBs that block a node drain forever.
status: published
---

*Post 13 of an 18-part Kubernetes concepts series.* ← [Cluster Architecture](/blog/k8s-cluster-architecture) · → [Observability](/blog/k8s-observability)

The single most useful distinction in this post, stated up front because almost everything else follows from it:

- **Voluntary disruption** — something *chose* to remove your Pod: a node drain, an autoscaler consolidating, a rolling update. Goes through the **Eviction API** and **respects PodDisruptionBudgets**.
- **Involuntary disruption** — the node ran out of memory, the kernel OOM-killed something, the VM died. **Node-pressure eviction does not respect PDBs.**

People assume a PDB protects availability generally. It doesn't — it only constrains the voluntary kind.

## The scheduler, briefly

Covered in [Cluster Architecture](/blog/k8s-cluster-architecture): filter nodes that *can* run the Pod, score the survivors, bind to the best one. Two properties matter here:

**Scheduling is one-shot.** Once bound, a Pod stays put regardless of how the cluster changes. Nothing rebalances automatically — that requires eviction plus rescheduling.

**Unschedulable Pods stay Pending.** `kubectl describe pod` shows why, and the message is usually precise: `Insufficient cpu`, `node(s) had untolerated taint`, `node(s) didn't match pod anti-affinity rules`, `node(s) had volume node affinity conflict` (that last one being the zonal-volume mismatch from [Storage](/blog/k8s-storage)).

## Node-pressure eviction

The **kubelet** monitors node resources and, when a threshold is crossed, evicts Pods to reclaim them. This is local to the node — no scheduler, no Eviction API, **no PDB check**.

Eviction signals include `memory.available`, `nodefs.available`, `nodefs.inodesFree`, and `imagefs.available`. Two threshold kinds:

- **Soft** — must hold for a grace period before eviction; Pods get their normal termination grace.
- **Hard** (defaults like `memory.available<100Mi`) — immediate eviction, **no graceful termination**.

Selection order when the kubelet must evict:

1. **QoS class** — BestEffort first, then Burstable, then Guaranteed ([Resource Management](/blog/k8s-resource-management))
2. **Usage relative to requests** — a Pod far above its request goes before one within it
3. **Priority** — lower priority first

This is the concrete payoff of setting requests: a Pod using less than it requested is near the back of the queue. A BestEffort Pod with no requests at all is first out the door.

Note that node-pressure eviction and **OOMKill** are different things. Eviction is the kubelet acting proactively at a threshold; OOMKill is the kernel killing a process that exceeded its cgroup limit. A Pod can be OOMKilled on a node under no pressure at all — that's just its own memory limit.

## API-initiated eviction

The other path: a client calls the **Eviction API** (what `kubectl drain` uses under the hood). This *does* check PDBs, and it's rejected if evicting would violate one — with a 429, so the caller retries.

## PodDisruptionBudget

A PDB constrains how many Pods of a workload can be voluntarily disrupted at once.

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-pdb
spec:
  minAvailable: 2          # or: maxUnavailable: 1
  selector:
    matchLabels:
      app: api
```

Use `minAvailable` when a fixed floor matters ("always at least 2 serving"), `maxUnavailable` when you care about churn rate ("never take down more than 1 at a time"). Percentages work for both.

Without a PDB, a node drain can legally evict every replica of a service simultaneously if they happen to share a node — which is exactly what happens during a cluster upgrade if replicas aren't spread ([Scheduling Workloads](/blog/k8s-workload-scheduling)).

Two classic misconfigurations, both of which **block node drains forever**:

- `minAvailable` equal to the replica count (`minAvailable: 3` on a 3-replica Deployment). Zero disruption is permitted, so no Pod can ever be evicted — the drain hangs indefinitely.
- A PDB on a **single-replica** Deployment with `minAvailable: 1`. Same result.

Both also block **Cluster Autoscaler and Karpenter scale-down**, which is a leading cause of "why won't this node ever go away" ([Autoscaling](/blog/k8s-autoscaling)).

And again: a PDB does nothing for involuntary disruption. If the node dies, all its Pods die, whatever the PDB says.

## Cordon, uncordon, and drain

**Cordon** marks a node unschedulable. Existing Pods keep running; no *new* Pods land there.

```bash
kubectl cordon node-1
kubectl uncordon node-1
```

**Drain** cordons *and* evicts everything, via the Eviction API — so PDBs apply:

```bash
kubectl drain node-1 --ignore-daemonsets --delete-emptydir-data
```

Two flags you'll essentially always need:

- `--ignore-daemonsets` — DaemonSet Pods are managed per node and would just be recreated; without this, drain refuses to proceed.
- `--delete-emptydir-data` — drain refuses to evict Pods with emptyDir volumes unless you confirm that data loss is acceptable.

The standard node-replacement sequence: `drain` → wait for Pods to reschedule elsewhere → terminate the node. Skipping the drain means every Pod on that node dies involuntarily — no graceful termination, no PDB respected, no [preStop hooks](/blog/k8s-health-lifecycle) honored.

If a drain hangs, it's almost always a PDB refusing eviction. `kubectl get pdb -A` and check whether `ALLOWED DISRUPTIONS` is `0`.

## Taints as an eviction mechanism

From [Scheduling Workloads](/blog/k8s-workload-scheduling): a `NoExecute` taint evicts existing Pods that don't tolerate it. Kubernetes uses this itself — the node controller applies `node.kubernetes.io/not-ready` and `node.kubernetes.io/unreachable` when a node stops reporting, and Pods are evicted after `tolerationSeconds` (default 300s, which is why a dead node's Pods take ~5 minutes to move).

The kubelet also applies pressure taints (`memory-pressure`, `disk-pressure`, `pid-pressure`) so the scheduler stops sending new work to a struggling node.

## On EKS and AKS

Eviction and PDB semantics are upstream and identical. What differs is **how often voluntary disruption actually happens** — and on both clouds, it's far more often than people expect:

- **Node upgrades** — both clouds cordon and drain nodes during Kubernetes version upgrades. PDBs directly control the blast radius, and a badly configured PDB will stall the upgrade.
- **Autoscaler consolidation** — Karpenter (EKS) and Karpenter-based Node Auto Provisioning (AKS) both actively terminate underutilized nodes to bin-pack. Karpenter respects PDBs and additionally supports its own **disruption budgets** to limit how much churn happens at once.
- **Spot / Spot VM reclamation** — a ~2-minute notice, then the node is gone. Both clouds run a handler (AWS Node Termination Handler or Karpenter's native interruption handling; AKS Scheduled Events) that cordons and drains on the notice — which is only useful if your Pods actually terminate gracefully in that window.

That last point ties the whole series together: PDBs plus correct `terminationGracePeriodSeconds` plus SIGTERM handling are what make routine, constant node churn invisible to users. Without them it's visible on every consolidation event — see [Reliability and Operations on EKS](/blog/eks-reliability-operations).

---

*Next:* [Observability: Logs, Events, Metrics, and kubectl top](/blog/k8s-observability)
