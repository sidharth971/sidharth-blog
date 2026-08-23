---
title: "Load Balancing and Ingress on EKS: ALB, NLB, and the Gateway API"
slug: eks-load-balancing-ingress-alb-nlb-gateway-api
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, load-balancer-controller, alb, nlb, ingress, gateway-api, tls
excerpt: How the AWS Load Balancer Controller maps Kubernetes Ingress and Service objects to real ALBs and NLBs, target types, TLS, readiness gates, and where the now-GA Gateway API fits.
status: published
---

The [ALB + Pod Identity post](/blog/path-based-routing-on-eks-with-the-aws-load-balancer-controller-pod-identity) in this series is the hands-on walkthrough; this one is the concept map around it — what the controller actually does, ALB vs. NLB, and where the Gateway API fits now that it's GA.

## One controller, two AWS resources

The **AWS Load Balancer Controller** watches two different Kubernetes object types and provisions two different AWS resources:

- **`Ingress`** → an **Application Load Balancer (ALB)**. Layer 7: host/path routing, TLS termination, one ALB can front many services.
- **`Service` of `type: LoadBalancer`** with the right annotations → a **Network Load Balancer (NLB)**. Layer 4: raw TCP/UDP, static IPs, lower latency, no path routing — one NLB per service, not shared.

Reach for ALB when you're routing HTTP(S) traffic by host or path across multiple backend services (exactly the `/app1`, `/app2` pattern from the earlier post). Reach for NLB when you need raw TCP/UDP, extreme low latency, a static IP, or you're fronting something that isn't HTTP at all (a gRPC service that wants its own connection semantics, a database proxy, etc.).

## Target types: instance vs. ip

Both ALB and NLB support two ways of registering backends:

- **`instance`** — traffic goes to a `NodePort` on each node, then gets kube-proxied to the right pod. Works everywhere, but adds a network hop and doesn't play well with Fargate (no visible "instance" to register).
- **`ip`** — traffic goes **directly to pod IPs**, bypassing kube-proxy entirely. Requires the VPC CNI (default on EKS) so pods have real routable VPC IPs — which they do, per the [networking post](/blog/eks-networking-vpc-cni-deep-dive). This is the recommended default for EKS: fewer hops, works with Fargate, and the controller manages the security group rules that allow the load balancer to reach pod IPs automatically. Set it via `alb.ingress.kubernetes.io/target-type: ip`.

## Ingress rules, TLS, and ExternalName

`Ingress` rules match on `host` and `path`, routing to backend `Service`s — that's the whole path-based-routing mechanic from the earlier post, generalized to host-based routing too (`api.example.com` → one service, `admin.example.com` → another, same ALB).

For TLS, attach an ACM certificate directly to the annotations rather than managing certs in-cluster:

```yaml
alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:us-east-1:111122223333:certificate/xxxxxxxx
alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'
alb.ingress.kubernetes.io/ssl-redirect: '443'
```

`ssl-redirect` adds an automatic HTTP→HTTPS redirect action on the listener — no separate ingress rule needed for it.

`ExternalName` services are the odd one out: instead of routing to pods, they're a DNS CNAME alias to something outside the cluster (an RDS endpoint, an external API). Occasionally useful for giving external dependencies a stable in-cluster name, but they don't integrate with the load balancer controller at all — no ALB/NLB involved, it's pure kube-dns aliasing.

## Readiness gates: avoiding the zero-downtime gap

Without readiness gates, there's a real race during rollouts: Kubernetes marks a new pod "Ready" as soon as its own readiness probe passes, but the ALB's **target group health check** takes its own separate time to mark that same pod healthy. In that gap, Kubernetes can route traffic to a pod the load balancer hasn't confirmed is actually reachable yet — dropped requests during otherwise-routine deploys.

**Pod readiness gates** close this gap: the controller injects an additional condition into the pod's readiness status that only flips true once the ALB target group *itself* reports the pod healthy. The pod isn't "Ready" to Kubernetes until it's actually receiving healthy traffic from the load balancer. Enable it by labeling the namespace:

```bash
kubectl label namespace sidhu-ns elbv2.k8s.aws/pod-readiness-gate-inject=enabled
```

Worth doing on any namespace running behind an ALB where rollout-time request drops actually matter.

## Where the Gateway API fits (now GA)

Gateway API is the Kubernetes-native successor to `Ingress` — more expressive routing (header/weight-based splitting, native L4+L7 in one model), vendor-neutral, standardized across implementations instead of everyone inventing their own annotation dialect. As of 2026, **AWS Load Balancer Controller has GA support for Gateway API**, covering both L4 (NLB, via `TCPRoute`/`UDPRoute`) and L7 (ALB, via `HTTPRoute`) — it's no longer an experimental path.

It's also newly relevant for a concrete reason: **ingress-nginx is being deprecated** (EOL reached in Q1 2026), which was the de facto standard Ingress controller for a huge number of clusters. Teams migrating off it are landing on Gateway API rather than another `Ingress`-annotation-based controller, since it's the direction the ecosystem is actually converging on.

Practical guidance for this series' cluster: `Ingress` + the AWS Load Balancer Controller (as already set up) remains completely supported and is the simpler mental model for straightforward host/path routing — there's no urgency to migrate a working `Ingress` setup. Reach for Gateway API on **new** setups, especially anything wanting traffic splitting/weighting for canary-style rollouts (see the Deployment Strategies post later in this series) or a shared, standardized routing layer across multiple teams/controllers.

## Next up

Traffic is reaching the cluster — the next question is who's allowed to *configure* the cluster and what pods are allowed to *call other AWS services*, which is [EKS Identity & Access](/blog/eks-identity-access-irsa-pod-identity-rbac).
