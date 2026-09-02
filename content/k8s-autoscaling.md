---
title: "Autoscaling in Kubernetes: HPA, VPA, Cluster Autoscaler, and metrics-server"
slug: k8s-autoscaling
category: Kubernetes
tags: kubernetes, k8s, autoscaling, hpa, vpa, cluster-autoscaler
excerpt: Three autoscalers answering three different questions — more Pods, bigger Pods, more nodes — why HPA and VPA conflict if pointed at the same metric, and how in-place pod resize going GA changes the VPA story.
status: published
---

*Post 9 of an 18-part Kubernetes concepts series.* ← [Security & RBAC](/blog/k8s-security-rbac) · → [Deployment Strategies](/blog/k8s-deployment-strategies)

Three autoscalers, three different questions. Confusing them — or running two that fight each other — is the usual source of autoscaling trouble.

- **HPA** — *how many* replicas?
- **VPA** — *how big* should each replica be?
- **Cluster Autoscaler** — *how many nodes* do we need underneath?

## metrics-server — the prerequisite

None of the CPU/memory-based autoscaling works without it. **metrics-server** collects resource usage from each kubelet and serves it through the Metrics API. It is **not** installed by default on vanilla Kubernetes.

```bash
kubectl top nodes
kubectl top pods -n prod
```

If those commands return an error, metrics-server is missing or unhealthy — and HPA will sit there reporting `<unknown>` for its metrics and never scale. It's the first thing to check when autoscaling "isn't working."

Worth being precise: metrics-server is for **autoscaling decisions**, not monitoring. It keeps only a short in-memory window with no history. Dashboards and alerting need Prometheus or equivalent ([Observability](/blog/k8s-observability)).

## Horizontal Pod Autoscaler

HPA adjusts a Deployment's (or StatefulSet's) replica count based on observed metrics.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 3
  maxReplicas: 30
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300      # wait 5m of calm before scaling down
      policies:
        - type: Percent
          value: 50
          periodSeconds: 60
```

The essential detail: **`averageUtilization` is a percentage of the CPU *request*, not of the node's capacity.** A Pod requesting 200m and using 140m is at 70% — regardless of how big the node is. That makes correct requests ([Resource Management](/blog/k8s-resource-management)) a prerequisite for sane HPA behavior; a wildly over-sized request means utilization never reaches the target and the HPA never scales up.

The `behavior` block is what prevents thrashing. The default scale-down stabilization window is 5 minutes precisely so a brief traffic dip doesn't immediately tear down capacity you'll need again in 30 seconds.

HPA also supports **custom** metrics (from Prometheus via an adapter) and **external** metrics (queue depth, for instance) — usually the better signal for queue consumers than CPU, which is a lagging proxy for "how much work is waiting."

## Vertical Pod Autoscaler

VPA watches actual usage and adjusts **requests and limits** rather than replica count. It has three modes, and the mode matters more than anything else about it:

- **`Off`** — computes recommendations only, changes nothing. Genuinely useful on its own as a right-sizing report.
- **`Initial`** — applies recommendations only when Pods are created.
- **`Auto` / `Recreate`** — actively applies recommendations to running Pods.

```yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: api
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  updatePolicy:
    updateMode: "Off"        # recommendation-only — the safest starting point
```

VPA's historical limitation was that applying a new recommendation required **evicting and recreating the Pod**, since resources were immutable on a running Pod. That made `Auto` mode disruptive and awkward.

That's changing: **in-place Pod resize went GA in Kubernetes 1.35**, so CPU and memory can be adjusted on a running Pod without a restart. VPA's own integration (`InPlaceOrRecreate` mode — resize in place where possible, fall back to eviction otherwise) is still **alpha** as of 2026, so it's worth tracking rather than depending on for a fully restart-free setup today.

**Don't run HPA and VPA on the same metric for the same workload.** HPA sees high CPU and adds replicas; VPA sees high CPU and raises requests, which lowers utilization, which makes HPA scale back down — they oscillate against each other. The safe combinations are VPA on memory + HPA on CPU, or HPA on a custom/external metric with VPA handling resources.

## Cluster Autoscaler

HPA can create Pods, but if no node has room they sit `Pending` forever. **Cluster Autoscaler** watches for unschedulable Pods and adds nodes, then removes nodes that stay underutilized and whose Pods can be rescheduled elsewhere.

It works by scaling **predefined node groups** (cloud autoscaling groups), which is its main constraint: it can only add more of the instance types you already defined, and provisioning goes through the cloud's ASG machinery, which is comparatively slow.

Scale-**down** is the subtler half. A node is only removed if its Pods can move elsewhere — and several things legitimately block that: Pods with no controller (bare Pods), restrictive PodDisruptionBudgets, local storage, or strict affinity rules. Nodes that "won't scale down" almost always trace to one of these ([Scheduling & Eviction](/blog/k8s-scheduling-eviction)).

**Karpenter** is the newer alternative that's largely displaced Cluster Autoscaler on the major clouds: instead of scaling predefined groups, it provisions the *specific* instance type that fits the pending Pods, and continuously consolidates workloads onto fewer/cheaper nodes.

## Scale-to-zero with KEDA

Plain HPA has a floor of `minReplicas: 1` — it cannot scale to zero. **KEDA** extends the model with event-driven scalers (queue length, Kafka lag, cron schedules, Prometheus queries) and can scale a workload down to **zero** replicas when idle, spinning it back up on the first event.

It doesn't replace HPA — it manages an HPA underneath once replicas exceed zero. The fit is bursty, event-driven work (a queue consumer idle most of the day), not steady HTTP services.

## On EKS and AKS

HPA, VPA, metrics-server, and KEDA are upstream and identical. Node autoscaling is where the clouds have both moved — and interestingly, to the *same* place:

| | EKS | AKS |
|---|---|---|
| Node autoscaling | Karpenter (the current default) or Cluster Autoscaler | Node Auto Provisioning (**Karpenter-based**, Azure provider) or Cluster Autoscaler |
| metrics-server | Add-on / manual install | Installed by default |
| KEDA | Helm install | Managed add-on |
| VPA | Manual install | Managed add-on |

The notable convergence: **both clouds now run Karpenter** for node autoprovisioning — AWS's original project, and Azure's NAP built on the same upstream with an Azure provider. Karpenter concepts (NodePools, requirements, consolidation, disruption budgets) transfer between them, which was not true of the older node-group-scaling model.

A practical AKS difference: metrics-server, KEDA, and VPA are all available as managed add-ons, whereas on EKS several of these are still Helm-installed components you own. The AWS-side details — Karpenter consolidation, KEDA scale-to-zero, cost implications — are in [Autoscaling on EKS](/blog/eks-compute-scaling-hpa-vpa-karpenter-keda).

---

*Next:* [Deployment Strategies: Rolling, Recreate, Blue/Green, Canary, and Shadow](/blog/k8s-deployment-strategies)
