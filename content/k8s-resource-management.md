---
title: "Resource Management in Kubernetes: Requests, Limits, ResourceQuota, LimitRange, and QoS"
slug: k8s-resource-management
category: Kubernetes
tags: kubernetes, k8s, resources, requests-limits, quota, qos
excerpt: Requests decide scheduling, limits decide enforcement — and CPU and memory limits behave completely differently when exceeded. Plus namespace-level ResourceQuota and LimitRange, and how QoS class decides who gets evicted first.
status: published
---

*Post 7 of an 18-part Kubernetes concepts series.* ← [Storage](/blog/k8s-storage) · → [Security & RBAC](/blog/k8s-security-rbac)

Two numbers per container, and most cluster stability problems trace back to getting them wrong — either omitted entirely (so the scheduler is flying blind) or copy-pasted from another service without measuring.

## Requests and limits

```yaml
resources:
  requests:
    cpu: "250m"      # 0.25 of a core
    memory: "256Mi"
  limits:
    cpu: "1"
    memory: "512Mi"
```

- **Request** = what the **scheduler** reserves. It's the number used to decide whether a Pod fits on a node. A node with 4 CPUs can hold Pods requesting 4 CPUs total, regardless of what they actually use.
- **Limit** = the ceiling the **runtime enforces** at execution time.

The crucial asymmetry, and the single most useful thing in this post:

**CPU is compressible.** Exceed the CPU limit and the container is **throttled** — slowed down, not killed. Symptoms are latency spikes and timeouts, with a perfectly healthy-looking Pod that never restarts. This is why CPU problems are harder to diagnose than memory problems.

**Memory is incompressible.** Exceed the memory limit and the container is **OOMKilled** immediately — no warning, no throttling, just `Exit Code 137` and a restart. `kubectl describe pod` shows `OOMKilled` in the last state.

That difference drives a widely-used practice: **always set memory limits** (an unbounded leak can take down a whole node), but be cautious with **CPU limits** — aggressive CPU limits throttle applications that could otherwise use idle capacity harmlessly. A common pattern is setting CPU requests but omitting CPU limits, while always setting memory request = limit.

Scheduling only ever considers **requests**, so a cluster can be "full" by requests while nodes sit at 10% actual utilization — which is the most common source of silent cloud waste, covered from the cost angle in [Cost Optimization on EKS](/blog/eks-cost-optimization).

## Quality of Service classes

Kubernetes derives a QoS class from requests and limits. You never set it directly; it's computed, and it determines **eviction order** when a node runs out of memory.

**Guaranteed** — every container has requests **equal to** limits, for both CPU and memory. Highest protection, evicted last.

```yaml
resources:
  requests: { cpu: "500m", memory: "512Mi" }
  limits:   { cpu: "500m", memory: "512Mi" }
```

**Burstable** — requests are set, but lower than limits (or limits are missing). Can use spare capacity when available, evicted after BestEffort.

**BestEffort** — no requests or limits at all. Free to use whatever's spare, and **first to be killed** under node pressure.

The practical implication: a critical workload with no resource spec isn't "flexible," it's *first in line to die* when a node gets tight. If something matters, give it at least a request.

## LimitRange — namespace defaults and bounds

`LimitRange` sets **per-container** defaults and min/max bounds within a namespace. Its main value is catching the developer who forgets to specify anything at all — instead of a BestEffort Pod, they get sensible defaults.

```yaml
apiVersion: v1
kind: LimitRange
metadata:
  name: defaults
  namespace: team-a
spec:
  limits:
    - type: Container
      default:                 # applied as limits if unspecified
        cpu: "500m"
        memory: "512Mi"
      defaultRequest:          # applied as requests if unspecified
        cpu: "100m"
        memory: "128Mi"
      max:
        cpu: "2"
        memory: "4Gi"
      min:
        cpu: "50m"
        memory: "64Mi"
```

A Pod exceeding `max` is **rejected at admission** — it never schedules, and the error surfaces immediately at `kubectl apply` time.

## ResourceQuota — namespace totals

Where LimitRange governs individual containers, `ResourceQuota` caps the **aggregate** for a whole namespace — total CPU/memory, and counts of objects.

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: team-a-quota
  namespace: team-a
spec:
  hard:
    requests.cpu: "20"
    requests.memory: 40Gi
    limits.cpu: "40"
    limits.memory: 80Gi
    persistentvolumeclaims: "20"
    count/deployments.apps: "50"
    pods: "100"
```

The gotcha that catches teams out: **once a ResourceQuota specifies CPU/memory, every Pod in that namespace must declare requests and limits for those resources**, or it's rejected. Which is precisely why ResourceQuota and LimitRange are usually deployed together — the LimitRange supplies defaults so existing manifests don't suddenly start failing admission.

Together they're the backbone of soft multi-tenancy: LimitRange stops one container from being absurd, ResourceQuota stops one team from consuming the whole cluster.

## Right-sizing in practice

Requests should come from **observed usage**, not guesses. The practical loop: deploy with a rough estimate, watch actual usage (`kubectl top pods`, or the VPA in recommendation-only mode — see [Autoscaling](/blog/k8s-autoscaling)), then set requests near the real steady-state and limits with reasonable headroom.

Two failure modes to avoid: requests far **above** real usage wastes money and blocks scheduling on nodes with capacity to spare; requests far **below** real usage packs nodes too tightly and gets Pods evicted under pressure.

## On EKS and AKS

Requests, limits, QoS, ResourceQuota, and LimitRange are pure upstream Kubernetes — identical on both clouds and unaffected by the managed control plane.

What differs is what's **allocatable**. Neither cloud gives your Pods 100% of a node: the kubelet, the container runtime, the CNI, and cloud agents all reserve capacity. `kubectl describe node` shows `Capacity` vs `Allocatable`, and the gap is real — a "4 vCPU / 16GB" node schedules meaningfully less than that.

- **EKS** — reservations scale with instance size, and the VPC CNI's per-node ENI/IP limits mean pod density can be capped by IPs before CPU or memory ([EKS Networking Deep Dive](/blog/eks-networking-vpc-cni-deep-dive)).
- **AKS** — reserves CPU and memory on a documented sliding scale, with a higher memory reservation than many people expect on small node SKUs.

Both also autoscale nodes based on **requests** (Karpenter on EKS, Karpenter-based Node Auto Provisioning on AKS), which makes accurate requests a direct cost lever, not just a scheduling detail — see [Autoscaling on EKS](/blog/eks-compute-scaling-hpa-vpa-karpenter-keda).

---

*Next:* [Security & RBAC: ServiceAccounts, Roles, SecurityContext, and Pod Security](/blog/k8s-security-rbac)
