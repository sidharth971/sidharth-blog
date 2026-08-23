---
title: "EKS Cluster Provisioning & Architecture: Control Plane, Node Groups, and Fargate"
slug: eks-cluster-provisioning-architecture
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, cluster-provisioning, eksctl, terraform, fargate, high-availability
excerpt: How an EKS cluster is actually put together — the managed control plane, your choice of node groups and Fargate, provisioning tools, upgrade strategy, endpoint access, and multi-AZ design.
status: published
---

Before anything else on this cluster — the ALB controller, Secrets Manager access — there's the cluster itself. This is the foundation post in the series: what EKS actually manages for you, what you still own, and the real decisions you make at cluster-creation time that are annoying to change later.

## The control plane is AWS's problem, not yours

EKS runs the Kubernetes control plane (API server, etcd, scheduler, controller manager) across multiple AZs inside an AWS-managed VPC, separate from your account's VPC. You don't patch it, don't scale it, don't see its nodes. What you *do* own:

- **Cluster version and upgrade timing** — EKS supports a rolling window of Kubernetes minor versions; you choose when to move, AWS doesn't force it until a version reaches end of standard support.
- **API server endpoint access** — public, private, or both (below).
- **Everything running on the data plane** — your nodes, whether EC2 or Fargate, are entirely your responsibility to patch, scale, and secure.

This split is the whole point of "managed" — AWS eliminates the hardest, most undifferentiated part (running etcd and the API server reliably) and leaves you the part that's actually specific to your workloads.

## Provisioning: eksctl, Terraform, or CloudFormation

Three realistic paths, and the choice mostly comes down to what already provisions the rest of your infrastructure:

- **eksctl** — the fastest way to stand up a cluster, purpose-built for EKS, great for prototyping and for scripted flows (it's what shows up in most AWS docs and quick-start guides). Less natural fit if the rest of your infra is already Terraform-managed, since it has its own state model.
- **Terraform** (`terraform-aws-modules/eks/aws` is the community-standard module) — the default choice if you're already managing VPCs, IAM, and everything else as code. Full control, plays well with existing state, but more upfront YAML/HCL than eksctl for a first cluster.
- **CloudFormation** — native AWS IaC, useful if your org has a hard "AWS-native tooling only" policy, but noticeably more verbose for EKS than the other two options and less commonly used in practice.

For anything beyond a throwaway demo cluster, Terraform is the pragmatic default — it's what most of this series' later posts (IAM roles, VPC config, add-ons) assume as the surrounding infrastructure, even though the actual `kubectl`/Helm steps shown are tool-agnostic.

## Cluster versions and upgrade strategy

EKS upgrades are **one minor version at a time** — you can't jump from 1.27 to 1.30 in a single call, you go 1.27 → 1.28 → 1.29 → 1.30. Plan for this:

- Upgrade the **control plane first**, then node groups, then add-ons (VPC CNI, CoreDNS, kube-proxy) — each has its own version compatibility matrix against the control plane version.
- Managed node groups can be upgraded in place (EKS drains and replaces nodes for you); self-managed node groups need you to handle the drain/replace cycle yourself.
- Keep an eye on **deprecated API versions** before upgrading — a control-plane upgrade will refuse workloads using APIs removed in the target version. Run `kubectl` API-deprecation checks (or `pluto`/`kubent`) against your manifests before every upgrade, not after.

## Node groups: managed, self-managed, and Fargate

Three ways to run pods on this cluster, and real clusters usually end up mixing at least two:

**EC2 managed node groups** — AWS handles the EC2 Auto Scaling Group, AMI selection/updates, and graceful node draining on upgrade/termination. This is the default choice for most workloads: you pick instance types, scaling bounds, and AWS does the operational plumbing.

**Self-managed node groups** — you own the Auto Scaling Group, launch template, and AMI directly. More control (custom AMIs, non-standard bootstrap logic, unusual instance configurations) at the cost of owning upgrade orchestration yourself. Reach for this only when managed node groups genuinely can't do what you need — it's more operational surface for most teams, not less.

**Fargate profiles** — no EC2 nodes at all for the pods that match the profile (by namespace/labels); AWS runs each pod in its own isolated micro-VM. No node patching, no capacity planning, pay per pod. Trade-offs: no DaemonSets (nothing to run one-per-node on), no privileged containers, and it's meaningfully more expensive per-vCPU than EC2 at steady, predictable load. Good fit for spiky/low-traffic namespaces (internal tooling, batch jobs) where the ops savings outweigh the per-hour cost.

**Hybrid (EC2 + Fargate)** is common and often the right answer: core, steady-state services on managed EC2 node groups; bursty or infrequent workloads (cron jobs, preview environments, internal admin tools) on Fargate profiles in their own namespace. You get the cost efficiency of reserved/steady EC2 capacity where it matters and zero-ops elasticity where predictability doesn't.

## Cluster endpoint access: public, private, or both

This determines how the Kubernetes API server itself is reachable — separate from how your *workloads* are exposed (that's the Ingress/ALB series).

- **Public only** — API reachable from the internet, restrictable by CIDR allow-list. Simplest for small teams, weakest default posture.
- **Private only** — API reachable only from inside the VPC (or peered/Transit-Gateway-connected networks). `kubectl` needs a bastion, VPN, or Cloud9/CodeBuild-in-VPC to reach it. This is what the ALB post in this series assumed for the *workload* ALB being internal — the control-plane endpoint is a separate, independent setting from that.
- **Public + private** — API reachable both ways, with the public path still restrictable by CIDR. Common middle ground: CI/CD and on-call reach it over the internet with IP allow-listing, while in-VPC traffic (nodes talking to the API) never leaves AWS's network.

Whichever you choose, remember: this setting is about API server reachability, not pod/service traffic — an internal ALB and a public cluster endpoint aren't in conflict, they're answering different questions.

## Multi-AZ high availability

The control plane is multi-AZ by default and out of your hands. What you control is the **data plane's** AZ distribution:

- Spread node groups (and their subnets) across at least 3 AZs — a single-AZ node group means an AZ outage takes your entire capacity with it, control plane or not.
- Combine with pod topology spread constraints (covered in the Workloads & Scheduling post later in this series) so the scheduler actually *uses* that multi-AZ capacity instead of accidentally clustering replicas in one AZ.
- Multi-AZ costs more in cross-AZ data transfer than single-AZ — worth knowing going in, not discovering on a bill.

## What's next in this series

Once the cluster exists, the next real decision is networking — how pods get IP addresses, how many you can actually run per node, and how traffic gets in and out. That's the next post: [EKS Networking Deep Dive](/blog/eks-networking-vpc-cni-deep-dive).
