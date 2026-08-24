---
title: "Reliability and Operations on EKS: Upgrades, DR, and Health Checks"
slug: eks-reliability-operations
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, reliability, upgrades, probes, chaos-engineering, velero
excerpt: Keeping a cluster healthy in practice — multi-AZ distribution revisited, how version upgrades and node rotation actually play out, backup/DR with Velero, the three probe types, graceful shutdown, and chaos testing.
status: published
---

Cost optimization (the [previous post](/blog/eks-cost-optimization)) is worthless if it comes at the expense of actually staying up. This post closes the loop on reliability — the operational practices that keep this cluster resilient day to day, not just correctly architected on paper.

## Multi-AZ pod distribution, revisited

The [cluster provisioning post](/blog/eks-cluster-provisioning-architecture) covered spreading node groups across AZs, and the [Workloads & Scheduling post](/blog/eks-workloads-scheduling) covered the topology spread constraints that actually make the scheduler use that multi-AZ capacity evenly. Worth restating as a reliability property, not just an architecture note: multi-AZ node groups without topology spread constraints give you the *capacity* for resilience without the *guarantee* of it — the scheduler has no reason to avoid clustering replicas in one AZ unless something tells it not to. Both pieces have to be in place together.

## Cluster upgrades and node rotation, in practice

The [cluster provisioning post](/blog/eks-cluster-provisioning-architecture) mentioned the one-minor-version-at-a-time upgrade path; here's what that looks like operationally. Control plane upgrades are AWS-managed and low-risk on their own — the real work is the data plane. Managed node groups support in-place upgrade orchestration (EKS drains and cycles nodes for you), but for anything running real traffic, forcing a **new node group + gradual pod migration + old node group decommission** pattern gives more control and an easy abort path if something looks wrong mid-rotation — versus in-place rotation, which is faster but commits earlier. Either way, this is exactly where the PodDisruptionBudgets from the Workloads & Scheduling post earn their keep: without one, a node drain during upgrade can legally take every replica of a service down at once if the scheduler decides that's the most efficient order.

## Backup and disaster recovery: Velero, revisited

The [Storage post](/blog/eks-storage-ebs-efs-csi-drivers) introduced Velero for snapshotting both cluster object state and PVC data. The reliability angle: Velero backups are only a DR *plan* once they've actually been restored somewhere and verified — a backup that's never been test-restored is a hypothesis, not a guarantee. Worth scheduling periodic restore drills into a scratch namespace or cluster, not just scheduling the backups themselves.

## The three probe types

Kubernetes has three distinct health-check mechanisms, and using the wrong one for the wrong purpose is a common source of either false restarts or traffic sent to broken pods:

- **Liveness probe** — "is this process still functioning, or should Kubernetes kill and restart the container?" Get this too aggressive (too short a timeout, checking something that can legitimately be slow) and you get restart-loops on otherwise-healthy pods.
- **Readiness probe** — "should this pod currently receive traffic?" This is what the [Load Balancing post's](/blog/eks-load-balancing-ingress-alb-nlb-gateway-api) readiness gates extend — a pod can be alive (liveness passing) but not ready (still warming up, temporarily overloaded, waiting on a dependency), and readiness is what pulls it out of the traffic pool without killing it.
- **Startup probe** — for slow-starting containers specifically: suppresses liveness checks until startup succeeds, so a legitimately slow boot (a JVM app with a long warm-up, for instance) doesn't get killed by an impatient liveness probe before it's even had a chance to become healthy.

```yaml
livenessProbe:
  httpGet: { path: /healthz, port: 8080 }
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /ready, port: 8080 }
  periodSeconds: 5
startupProbe:
  httpGet: { path: /healthz, port: 8080 }
  failureThreshold: 30
  periodSeconds: 10
```

## Graceful shutdown

When a pod is terminated (scaling down, a node drain, a deploy), Kubernetes sends `SIGTERM`, waits `terminationGracePeriodSeconds` (default 30s), then `SIGKILL`s anything still running. An application that doesn't handle `SIGTERM` — finishing in-flight requests, closing connections cleanly — gets hard-killed mid-request on every single rollout and scale-down, not just rare occasions. This is a code-level concern more than a Kubernetes-config one, but it's worth stating plainly: **every EKS reliability practice in this series is undermined by an app that doesn't shut down cleanly**, since it turns routine, expected events (deploys, consolidation, node rotation) into user-visible errors.

## Chaos engineering: testing the failure paths on purpose

Everything above is a mechanism that's supposed to handle failure gracefully — chaos engineering is verifying that it actually does, before a real failure proves otherwise. Two complementary layers on AWS/EKS:

- **AWS Fault Injection Service (FIS)** — operates at the AWS resource level: terminate a percentage of nodes, throttle an API, simulate an AZ failure. Tests whether the *infrastructure* (multi-AZ node groups, Karpenter replacing lost capacity, PDBs limiting simultaneous disruption) actually holds up.
- **Chaos Mesh / LitmusChaos** — operate at the Kubernetes/pod level: kill a specific pod, inject network latency, stress a container's CPU. Tests whether the *application* (readiness probes, retries, graceful degradation) actually holds up. FIS integrates with both, so a single experiment can combine an AWS-level fault (kill nodes) with a pod-level fault (stress a dependency) in one coordinated test.

Neither replaces the other — FIS without pod-level chaos never tests whether your app actually degrades gracefully under stress; pod-level chaos without FIS never tests whether the cluster's infrastructure-level resilience (the whole first half of this series) actually works under a real AZ or node-fleet disruption.

## Next up

[CI/CD and Add-ons](/blog/eks-cicd-addons) — the last post in this series: how code and infrastructure actually get onto this cluster, and the managed add-ons ecosystem that's grown since the very first post.
