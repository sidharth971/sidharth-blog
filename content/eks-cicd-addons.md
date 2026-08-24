---
title: "CI/CD and Add-ons on EKS: Managed Add-ons, GitHub Actions, and IaC"
slug: eks-cicd-addons
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, cicd, add-ons, terraform, helm
excerpt: The EKS managed add-ons ecosystem (now including a community catalog beyond the core set), how ECR/CodePipeline/GitHub Actions/Jenkins fit the deployment strategies from earlier, Helm vs Kustomize, and Terraform as the layer underneath everything in this series.
status: published
---

The last post in this series. Everything from [cluster provisioning](/blog/eks-cluster-provisioning-architecture) through [reliability](/blog/eks-reliability-operations) has been about the cluster and what runs on it — this one is about how code and infrastructure actually get there, and the add-ons ecosystem that's grown since the first post.

## EKS managed add-ons: bigger than it used to be

The **Pod Identity agent** used throughout this series, and VPC CNI/CoreDNS/kube-proxy mentioned in the [cluster provisioning post](/blog/eks-cluster-provisioning-architecture), are all **managed add-ons** — installed and version-managed through the EKS API rather than `kubectl apply`d by hand, with AWS handling security patches and compatibility validation against your cluster's Kubernetes version:

```bash
aws eks create-addon --cluster-name sidhu-cluster --addon-name vpc-cni
aws eks create-addon --cluster-name sidhu-cluster --addon-name eks-pod-identity-agent
aws eks create-addon --cluster-name sidhu-cluster --addon-name amazon-cloudwatch-observability
```

The core set has grown over the life of this series (`amazon-cloudwatch-observability` from the [Observability post](/blog/eks-observability-cloudwatch-prometheus), `aws-ebs-csi-driver`/`aws-efs-csi-driver` from the [Storage post](/blog/eks-storage-ebs-efs-csi-drivers)). More recently, AWS introduced a **community add-ons catalog** extending the same managed-installation model to widely-used open-source tools that used to be Helm-only: `metrics-server` (needed for the HPA from the [Compute Scaling post](/blog/eks-compute-scaling-hpa-vpa-karpenter-keda)), `cert-manager`, `external-dns`, `kube-state-metrics`, `prometheus-node-exporter`. Each is scanned, packaged, and hosted in an EKS-owned ECR repo rather than pulled from wherever the upstream Helm chart happens to reference. Worth checking the add-on catalog before reaching for a raw Helm install by default now — it's a materially shorter list of "things I have to keep patched myself" than it was even a year or two into this series.

## CI/CD: where ECR and pipelines fit

**ECR** is the registry every image in this series ultimately lives in before a pod pulls it — paired with the scanning covered in the [Security post](/blog/eks-security-compliance). The actual build-and-push pipeline is where **CodePipeline**, **GitHub Actions**, and **Jenkins** differ mostly in where they run and what they integrate with natively, not in fundamental capability:

- **GitHub Actions** — the natural choice if source already lives on GitHub; OIDC federation to an IAM role (the same Pod-Identity-adjacent IAM patterns from the [Identity & Access post](/blog/eks-identity-access-irsa-pod-identity-rbac), applied to a CI runner instead of a pod) avoids long-lived AWS credentials in CI secrets entirely.
- **CodePipeline** — the AWS-native option, tightest integration with the rest of the AWS ecosystem (CodeBuild, EventBridge triggers, native ECR integration), the default if the org is already CodeCommit/CodeBuild-centric.
- **Jenkins** — the choice when there's existing organizational investment in Jenkins infrastructure and plugins, or requirements (specific compliance tooling, on-prem runners) the SaaS options don't fit.

Whichever builds and pushes the image, what happens *after* the push is where the [Deployment Strategies post](/blog/eks-deployment-strategies) and its GitOps coverage come back in: the CI pipeline's job ends at "new image exists in ECR with a new tag" — ArgoCD/Flux picking up a manifest change (or Argo Rollouts/Flagger managing the actual rollout) is a separate, decoupled step, not something the CI pipeline should be doing via `kubectl apply` directly if a GitOps model is in place.

## Helm vs. Kustomize

Both templatize/compose Kubernetes manifests, but differently: **Helm** templates values into a chart (a single parameterized package, versioned as a unit, easy to publish/reuse across teams or organizations) — this is the packaging layer the [Deployment Strategies post](/blog/eks-deployment-strategies) described. **Kustomize** takes a different approach — no templating language at all, just base manifests plus declarative overlay patches per environment (`overlays/dev`, `overlays/prod`), built into `kubectl` itself with no extra tooling required. Teams publishing a reusable package (an open-source tool, a platform team's internal app template) reach for Helm; teams just managing environment-specific variations of their *own* manifests often find Kustomize's patch model simpler, with less templating-language overhead. The two aren't mutually exclusive either — Kustomize can patch the output of a Helm template, a pattern that shows up more than either tool's docs suggest.

## Terraform: the layer underneath everything in this series

Every AWS resource this series has touched — the cluster itself, IAM roles and Pod Identity associations, VPC/subnets, the RDS instances from the [Database post](/blog/eks-database-integrations-rds) — is exactly the kind of infrastructure the [Terraform day-by-day series](/blog/terraform-day-01-introduction-to-terraform) on this same blog covers from first principles. If any of the AWS-side setup in this EKS series felt unfamiliar — IAM policies and trust relationships, remote state, meta-arguments for provisioning multiple similar resources — that series is the ground-up version of exactly those mechanics.

## Series wrap

That's all 15 topics: cluster architecture, networking, load balancing, identity, secrets, storage, scaling, workloads, deployment strategy, observability, security, databases, cost, reliability, and now CI/CD — the operational core of running real workloads on EKS, end to end. Every post in this series links to the others where the topics actually connect, so it's meant to be read as a whole, not just as fifteen disconnected reference pages.
