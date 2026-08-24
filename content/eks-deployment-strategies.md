---
title: "Deployment Strategies on EKS: Rolling, Blue/Green, Canary, and GitOps"
slug: eks-deployment-strategies
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, deployment, canary, gitops, argocd, helm
excerpt: Rolling updates vs blue/green vs canary, where Argo Rollouts and Flagger fit relative to each other, GitOps with ArgoCD/Flux, and Helm as the packaging layer underneath all of it.
status: published
---

The [Workloads & Scheduling post](/blog/eks-workloads-scheduling) covered what a Deployment *is*; this one covers how you actually roll a new version out to it without breaking things.

## Rolling update vs. recreate

Kubernetes' native `Deployment` strategy is **rolling update** by default: new-version pods come up gradually while old-version pods are gradually removed, with `maxSurge`/`maxUnavailable` controlling how aggressive the transition is. **Recreate** is the alternative — kill everything old, then start everything new — which means guaranteed downtime, but is sometimes required when old and new versions genuinely can't run side by side (a schema-incompatible database migration, for example).

Rolling update is the right default for almost everything. Recreate is a deliberate exception, not a fallback.

## Blue/green

Two complete environments (old = blue, new = green) running simultaneously, with traffic cut over from one to the other in a single step rather than gradually. On EKS this is typically implemented via the Ingress/Service layer — two Deployments, two label sets, and a Service selector (or the ALB target group, same mechanism the [Load Balancing post](/blog/eks-load-balancing-ingress-alb-nlb-gateway-api) covers) that flips from one to the other. The value over a plain rolling update: instant rollback (flip the selector back) and the new version is fully warm and tested *before* it receives any real traffic — at the cost of running double the capacity during the transition.

## Canary: Argo Rollouts vs. Flagger

**Canary** releases send a small percentage of traffic to the new version, watch metrics, and progressively shift more traffic over if things look healthy — the middle ground between "all at once" (rolling update) and "everything, instantly" (blue/green). Two tools dominate this on Kubernetes, and they solve it differently enough that picking the wrong one for your setup causes real friction:

- **Argo Rollouts** — replaces the `Deployment` resource with a `Rollout` CRD that defines explicit, step-based promotion (`setWeight: 20`, pause, `setWeight: 50`, pause, …), including manual approval gates between steps. Requires migrating from `Deployment` to `Rollout`, which is a real (if mechanical) migration. Integrates natively with the AWS Load Balancer Controller's weighted target groups, so it can do ALB-level canary traffic-shifting without a service mesh.
- **Flagger** — keeps your existing `Deployment` untouched and layers a `Canary` resource alongside it; Flagger manages the traffic split and promotion automatically based on metric analysis (error rate, latency), with no manifest migration required.

The practical decision usually isn't "which is technically better" — it's which GitOps tool you're already running: **Argo Rollouts pairs naturally with ArgoCD**, **Flagger pairs naturally with Flux**. Matching the progressive-delivery tool to the GitOps controller you already operate avoids running two overlapping reconciliation loops against the same resources.

## GitOps: ArgoCD and Flux

Both continuously reconcile cluster state to match a Git repository — instead of `kubectl apply` or a CI pipeline pushing changes *to* the cluster, an in-cluster controller *pulls* from Git and converges to it, self-healing any drift (including the drift the [Terraform series' Day 30 post](/blog/terraform-day-30-drift-detection-auto-remediation) covers at the infrastructure layer — this is the same idea, one layer up, at the Kubernetes-manifest layer). **ArgoCD** adds a strong UI and application-centric model (an `Application` CRD per deployable unit); **Flux** is more composable/CLI-and-CRD-first, commonly assembled from separate controllers (source, kustomize, helm). Either is a defensible default; consistency with whichever progressive-delivery tool you picked above matters more than which GitOps tool wins on paper.

## Helm: the packaging layer underneath all of it

Independent of which rollout strategy or GitOps tool sits on top, **Helm** is how most non-trivial Kubernetes applications get templated and versioned in the first place — a "chart" bundles manifests with a templating layer and a values file, so the same chart deploys to dev/staging/prod with different `values.yaml` overrides instead of maintaining parallel copies of raw YAML. ArgoCD and Flux both natively render Helm charts as part of their reconciliation, so Helm isn't in competition with GitOps — it's the templating format GitOps tools render before applying.

## Which combination to actually run

A reasonable default for a team starting from scratch: Helm charts in Git, ArgoCD watching the repo and reconciling automatically (self-healing, so manual `kubectl` drift gets reverted), plain rolling updates for most services, and Argo Rollouts specifically for the handful of services where a bad deploy is expensive enough to justify canary analysis. Escalate to blue/green only for the rare case where even a canary's brief exposure window is unacceptable.

## Next up

[Observability](/blog/eks-observability-cloudwatch-prometheus) — once deployments are rolling out safely, the next question is how you actually see what's happening inside the cluster.
