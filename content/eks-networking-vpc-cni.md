---
title: "EKS Networking Deep Dive: VPC CNI, Pod IPs, and Security Groups for Pods"
slug: eks-networking-vpc-cni-deep-dive
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, vpc-cni, networking, security-groups, coredns, network-policy
excerpt: How pods actually get IP addresses on EKS, why you run out of them faster than expected, prefix delegation, security groups for pods, NAT design, and CoreDNS/network policy basics.
status: published
---

Following on from [cluster provisioning](/blog/eks-cluster-provisioning-architecture) — once nodes exist, the next thing that breaks in production isn't compute, it's IP addresses. EKS networking has a specific personality because of one design choice: **pods get real VPC IP addresses**, not an overlay network. That's the source of almost everything interesting (and annoying) in this post.

## The VPC CNI plugin: pods are first-class VPC citizens

The AWS VPC CNI plugin assigns each pod an IP address from the VPC's subnet ranges — the same address space your EC2 instances and RDS databases live in. No overlay, no NAT between pod and node. This is why pods can talk directly to VPC-native services (RDS, ElastiCache) without extra plumbing, and why VPC security groups and route tables apply to pod traffic the same way they apply to EC2 traffic.

The cost of that simplicity: **IP addresses are a finite, pre-allocated resource**, and node capacity for pods is bounded by ENI/IP limits, not just CPU/memory.

## Pod IP exhaustion and prefix delegation

Every EC2 instance type has a hard limit on how many ENIs it can attach and how many IPs each ENI can hold — which sets a hard ceiling on pods-per-node, often well below what CPU/memory would otherwise allow. Two symptoms tell you you've hit this: pods stuck `Pending` with no obvious resource pressure, and subnets running out of free IPs faster than instance count would suggest.

**Prefix delegation** is the fix: instead of assigning individual IPs to an ENI, EKS assigns `/28` prefixes (16 addresses per prefix) in one allocation. Enable it via the VPC CNI's `ENABLE_PREFIX_DELEGATION=true` setting, tune `WARM_PREFIX_TARGET` (default `1`) to control how many spare prefixes are kept warm for fast pod starts vs. how many addresses sit idle. Before turning this on, confirm your subnets actually have contiguous `/28`-aligned free blocks — a fragmented subnet can't satisfy prefix allocation even with plenty of raw IPs left.

```bash
kubectl set env daemonset aws-node -n kube-system ENABLE_PREFIX_DELEGATION=true
kubectl set env daemonset aws-node -n kube-system WARM_PREFIX_TARGET=1
```

Reach for prefix delegation specifically when pod density is the bottleneck — not as a default-on setting for every cluster.

## Persistent VPC: decouple networking lifecycle from cluster lifecycle

Provision the VPC, subnets, and NAT gateways **outside** of the EKS cluster's own IaC stack/module, as their own long-lived Terraform state (or CloudFormation stack). Reasoning: you'll recreate clusters — for major version jumps, blast-radius isolation, disaster recovery drills — far more often than you'll want to touch IP ranges, subnet layout, or anything peered/routed to this VPC. Coupling them means every cluster rebuild risks re-provisioning networking, which is exactly the kind of accidental blast radius you don't want.

## Subnet tiers and security groups

A typical production layout has three subnet tiers per AZ:

- **Public** — NAT gateways, internet-facing load balancers only. Nothing else should sit here.
- **Private** — worker nodes and pods. No direct internet route; outbound goes through NAT.
- **Database/isolated** — RDS, ElastiCache. No route to the internet at all, inbound only from app-tier security groups.

Security groups compose across this: a **node security group** (node-to-node and node-to-control-plane traffic), and separately, database security groups that allow inbound only from the specific SGs that need DB access — not from a CIDR range, from a security group reference. This is where **Security Groups for Pods** matters: normally all pods on a node share the node's security group, which is too coarse when only *some* pods on a node should reach the database. Security Groups for Pods (via the VPC resource controller + trunk ENIs) lets you attach a dedicated SG directly to specific pods via a `SecurityGroupPolicy`, so the DB security group can allow inbound from the pod's own SG rather than the whole node's.

## NAT gateway: single vs. highly available

Outbound internet access from private subnets goes through a NAT gateway. Two shapes:

- **Single NAT gateway** — one NAT in one AZ, all private subnets route through it. Cheaper, but it's a single point of failure *and* every cross-AZ hop to reach it costs cross-AZ data transfer.
- **One NAT gateway per AZ** — each AZ's private subnets route through their own AZ's NAT. No cross-AZ dependency for outbound traffic, survives an AZ outage without losing egress cluster-wide. Standard for anything beyond dev/test.

The cost delta is real (NAT gateways aren't cheap per-AZ) but usually smaller than the blast radius of a single-NAT outage taking down all outbound traffic — including image pulls, which means new pods can't even start.

## VPC peering and Transit Gateway

When this cluster needs to reach resources in other VPCs (a shared services VPC, another team's account) — **VPC peering** for a small, stable number of point-to-point connections; **Transit Gateway** once you're peering with more than a handful of VPCs, since peering doesn't transit (A peered with B, B peered with C, doesn't give A reachability to C) and the mesh gets unmanageable past a few VPCs. Transit Gateway centralizes routing at the cost of being another piece of infrastructure to design and monitor.

## CoreDNS

Cluster-internal DNS (`service.namespace.svc.cluster.local` resolution) runs as CoreDNS pods, deployed as an EKS-managed add-on. Two things worth knowing in production: it autoscales via a `cluster-proportional-autoscaler` pattern (or the `coredns-autoscaler` add-on) so DNS capacity tracks cluster size, and DNS latency/errors are one of the first things to check when "everything is intermittently slow" — `kubectl logs` on the CoreDNS pods and `kubectl top pods -n kube-system` are cheap first diagnostics before chasing anything more exotic.

## Network policies (Calico / Cilium)

By default, Kubernetes networking is flat — any pod can reach any other pod, cluster-wide. **NetworkPolicy** resources restrict that, but the default VPC CNI doesn't enforce them on its own; you need a policy engine. **Calico** is the more established, narrowly-scoped choice (network policy enforcement, nothing else). **Cilium** does the same job via eBPF and additionally can replace kube-proxy, add L7-aware policies, and provide richer network observability — more capability, more to operate. For a cluster whose main need is "namespace X can't reach namespace Y's database," Calico is usually the simpler correct answer; reach for Cilium when you specifically want its eBPF dataplane or L7 policy features.

## Next up

With pods reachable and addressable, the next question is how *external* traffic reaches them — that's [Load Balancing & Ingress](/blog/eks-load-balancing-ingress-alb-nlb-gateway-api), which builds directly on the [ALB + Pod Identity setup](/blog/path-based-routing-on-eks-with-the-aws-load-balancer-controller-pod-identity) already covered in this series.
