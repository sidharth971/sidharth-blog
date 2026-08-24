---
title: "Cost Optimization on EKS: Spot, Karpenter Consolidation, and Fargate vs EC2"
slug: eks-cost-optimization
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, cost-optimization, spot-instances, karpenter, savings-plans
excerpt: Where EKS costs actually come from and the levers that move them — Spot mix, Karpenter's automatic consolidation, right-sizing with real usage data, Fargate vs EC2 cost modeling, and scale-to-zero.
status: published
---

Everything earlier in this series has been about correctness and reliability. This post is about the bill — the concrete levers that move EKS spend without giving up the guarantees the rest of the series built in.

## Spot instances: the biggest single lever

EC2 Spot capacity runs 60-90% cheaper than On-Demand, with the trade-off that AWS can reclaim it with a 2-minute warning. On EKS this is a genuinely good trade for **stateless, horizontally-scaled workloads** — anything a Deployment can reschedule elsewhere without drama fits well; anything stateful with a single replica (a database, a leader-election-based singleton) doesn't belong on Spot at all.

With Karpenter (from the [Compute Scaling post](/blog/eks-compute-scaling-hpa-vpa-karpenter-keda)), mixing Spot and On-Demand is a NodePool-level policy rather than separate node groups to manage by hand:

```yaml
requirements:
  - key: karpenter.sh/capacity-type
    operator: In
    values: ["spot", "on-demand"]
```

A common split: a small On-Demand NodePool floor for anything that can't tolerate interruption (or as guaranteed capacity for critical system pods), Spot for the bulk of horizontally-scaled application capacity.

## Karpenter consolidation: savings that happen automatically

Beyond just picking Spot vs On-Demand, Karpenter actively works to reduce waste on an ongoing basis — its consolidation logic continuously looks for opportunities to move pods onto fewer or cheaper nodes and terminates the ones that become empty, rather than leaving underutilized nodes running until something else triggers a scale-down. This is the mechanism behind the 20-35% node-count reduction figure mentioned in the Compute Scaling post — it's not a one-time migration benefit, it's a continuous background process. The only cost is brief pod rescheduling as consolidation moves things around, which is why it matters that the [PodDisruptionBudgets](/blog/eks-workloads-scheduling) from earlier in the series are actually set — without them, aggressive consolidation has no guardrail on how many replicas of something it can evict at once.

## Right-sizing with real data, not guesses

The [Compute Scaling post](/blog/eks-compute-scaling-hpa-vpa-karpenter-keda) covered VPA's role in *recommending* correct requests/limits; the cost angle is the flip side of the same coin — over-provisioned requests are the single most common source of silent EKS waste, because Karpenter and Cluster Autoscaler both size nodes to fit *requested* resources, not actual usage. A pod requesting 2 vCPU while consistently using 200m is costing roughly 10x what it needs, invisibly, until someone actually looks at VPA's recommendations or a cost-visibility tool against real utilization.

## Fargate vs. EC2: where the crossover actually sits

Fargate's per-pod pricing has no idle capacity — you pay for exactly what's requested, nothing more — while EC2 nodes have some amount of unavoidable slack (bin-packing is never perfect, and there's a per-node overhead reserved for the kubelet and system pods). But Fargate's per-vCPU/GB rate is meaningfully higher than EC2 On-Demand, and dramatically higher than EC2 Spot. The practical crossover: Fargate wins for **spiky, unpredictable, or low-total-volume** workloads (the [cluster provisioning post's](/blog/eks-cluster-provisioning-architecture) example of internal tooling and preview environments); EC2 — especially Spot-heavy, Karpenter-consolidated EC2 — wins for **steady, high-volume** workloads where the operational simplicity Fargate buys isn't worth its cost premium at that scale.

There isn't a universal answer — it's genuinely workload-shape-dependent, which is exactly why the hybrid EC2+Fargate pattern from the first post in this series exists rather than one approach winning outright.

## Scale-to-zero

KEDA's scale-to-zero (from the Compute Scaling post) is a cost lever as much as an architectural one — a queue-consumer Deployment sitting at zero replicas most of the day, scaling up only when there's actual work, costs literally nothing in compute while idle (versus HPA's floor of 1 replica, which is always running, always billing). Combined with Karpenter consolidation, a KEDA-scaled-to-zero workload doesn't just remove its own pods when idle — it can let Karpenter remove the now-empty nodes underneath it too.

## Savings Plans and Reserved Instances

Spot and Karpenter consolidation address variable, interruptible capacity. For the **floor** — the On-Demand capacity that's genuinely always running (the baseline of a production cluster that never scales to zero) — Compute Savings Plans or Reserved Instances are the complementary lever, committing to a spend level in exchange for a discount versus On-Demand pricing. These aren't EKS-specific mechanisms (they apply at the AWS billing level across any EC2 usage), but they stack correctly with everything above: Savings Plans covering the predictable floor, Spot + Karpenter handling the variable rest.

## Next up

[Reliability & Operations](/blog/eks-reliability-operations) — keeping this cluster healthy through upgrades, node rotation, and actual failures, not just cheap.
