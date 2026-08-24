---
title: "Autoscaling on EKS: HPA, VPA, Cluster Autoscaler, Karpenter, and KEDA"
slug: eks-compute-scaling-hpa-vpa-karpenter-keda
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, autoscaling, karpenter, hpa, vpa, keda
excerpt: Five different autoscalers that answer different questions — pod count, pod size, node count, and event-driven scaling — including where Karpenter has displaced Cluster Autoscaler as the 2026 default.
status: published
---

Five tools, five different questions. Mixing them up (or running the wrong combination together) is the most common EKS scaling mistake — this post is about which one actually answers which question.

## HPA — how many replicas of this pod?

The **Horizontal Pod Autoscaler** scales replica count for a Deployment/StatefulSet based on observed metrics — CPU/memory by default (via `metrics-server`), or custom/external metrics (queue depth, request latency) via the custom metrics API.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: app-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: app
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

This is the default, obvious answer to "traffic went up, I need more pods" — but it only scales pod *count*, not pod *size*, and it does nothing if the cluster has no spare node capacity to schedule those new pods onto (that's Cluster Autoscaler's/Karpenter's job, below).

## VPA — how big should each pod be?

The **Vertical Pod Autoscaler** recommends (or actively sets) CPU/memory requests and limits based on actual observed usage, instead of you guessing at request/limit values and either over-provisioning (wasted spend) or under-provisioning (throttling, OOMKills).

Historically, VPA's biggest practical limitation was that applying a new recommendation required **evicting and recreating the pod** — a real disruption, which made it awkward to run alongside HPA on the same workload. That's changing: **in-place pod resize went GA in Kubernetes 1.35** (available now on EKS, which supports up to 1.36), so a pod's resource requests/limits can be adjusted live without a restart. VPA's own integration with this (`InPlaceOrRecreate` update mode) is still **alpha** as of 2026 — it uses in-place resize when possible and falls back to the old evict-and-recreate behavior otherwise. Worth watching, not yet something to depend on for a fully restart-free experience in production.

Don't run VPA and HPA on the *same* metric (e.g., both reacting to CPU) for the same workload — they'll fight each other. If you want both, VPA on memory and HPA on CPU (or HPA on a custom metric) is the usual way to combine them safely.

## Cluster Autoscaler vs. Karpenter — how many nodes?

Both answer "do we have enough node capacity to schedule pending pods," but they work fundamentally differently, and as of 2026 this isn't really a close call anymore:

- **Cluster Autoscaler** — scales predefined Auto Scaling Groups / managed node groups up and down. Simple mental model, but provisioning is slow (often 3-4 minutes, since it's working through ASG semantics) and it can only pick from the instance types you predefined in each node group.
- **Karpenter** — reached GA in late 2024 and is now the default for new EKS clusters (it's also the engine behind **EKS Auto Mode**). It provisions nodes directly via EC2 APIs rather than through ASGs, picks the *exact* instance type/size that fits the pending pod instead of the closest predefined match, and typically brings a node up in 45-60 seconds. Its consolidation logic actively bin-packs and removes underutilized nodes, which is where most of the reported cost savings over Cluster Autoscaler come from (teams moving from Cluster Autoscaler commonly see 20-35% fewer nodes for the same workload).

For a new cluster in 2026, Karpenter is the right default. Cluster Autoscaler is still fully supported and reasonable to keep if a cluster already runs it and there's no active pain — but it's no longer the thing to reach for on a fresh setup.

## KEDA — scale from zero, and scale on things that aren't CPU

**KEDA (Kubernetes Event-Driven Autoscaling)** extends the HPA model to scale on external event sources — SQS queue depth, Kafka lag, a cron schedule, a Prometheus query — and critically, it can scale a Deployment **to zero** when there's no work, which plain HPA cannot do (HPA's `minReplicas` floor is 1). Under the hood, KEDA actually manages an HPA object for you once replica count is above zero; it's an addition to HPA, not a replacement for it.

Reach for KEDA specifically when the workload is event-driven and bursty enough that "zero replicas most of the time, scale up on demand" is the right shape — a queue consumer that's idle 90% of the day is the canonical example. It's not a fit for steady-traffic HTTP services where HPA alone is simpler and sufficient.

## Putting it together

A realistic cluster running all of this at once isn't unusual: Karpenter provisioning nodes, HPA scaling API-serving Deployments on CPU, VPA right-sizing a handful of memory-heavy background workers, and KEDA scaling a queue-consumer Deployment from zero based on SQS depth — each one answering a different question, all four coexisting without conflict because their responsibilities don't overlap.

## Next up

[Workloads & Scheduling](/blog/eks-workloads-scheduling) — the Kubernetes object types and scheduling controls (affinity, taints, topology spread) that everything above ultimately acts on.
