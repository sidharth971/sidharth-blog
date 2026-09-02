---
title: "Service Mesh on Kubernetes: Istio, Envoy, VirtualService, and Traffic Mirroring"
slug: k8s-service-mesh
category: Kubernetes
tags: kubernetes, k8s, service-mesh, istio, envoy, mtls
excerpt: What a mesh actually adds over plain Services, the Envoy data plane, Istio's traffic objects — and why ambient mode (GA since 1.24) replacing sidecars with a per-node ztunnel changes the cost calculation substantially.
status: published
---

*Post 16 of an 18-part Kubernetes concepts series.* ← [Helm](/blog/k8s-helm) · → [Extensibility](/blog/k8s-extensibility)

Plain Kubernetes Services do L4 round-robin load balancing and nothing else — no retries, no timeouts, no circuit breaking, no encryption between Pods, no per-request telemetry. A service mesh adds all of that **without changing application code**, by intercepting traffic at the infrastructure layer.

The honest framing: a mesh is a significant amount of machinery. For a handful of services it's usually overkill — application-level retry libraries and TLS are simpler. It earns its place when you have enough services that implementing this consistently in every language you use becomes the harder problem.

## Data plane and control plane

Every mesh splits the same way:

- **Data plane** — proxies that actually carry the traffic, intercepting every request in and out of your workloads.
- **Control plane** — configures those proxies from your high-level intent (Istio's `istiod`).

**Envoy** is the proxy behind most meshes (Istio, Consul, previously Linkerd's early versions and AWS App Mesh). It's an L7 proxy with dynamic configuration APIs — the control plane pushes routing and policy to it at runtime without restarts, which is what makes mesh config changes take effect instantly.

## What a mesh actually gives you

- **mTLS everywhere** — every service-to-service connection encrypted and mutually authenticated, with certificates issued and rotated automatically. This is the single most common reason to adopt one, and it's very hard to retrofit into applications individually.
- **Traffic management** — retries, timeouts, circuit breaking, outlier detection, weighted routing, header-based routing, fault injection.
- **Observability** — consistent L7 metrics (request rate, error rate, latency percentiles) for *every* service, without instrumenting any of them, plus trace span propagation.
- **Policy** — authorization rules on service-to-service calls (`service-A may call service-B on POST /orders`), which is a layer above what [NetworkPolicy](/blog/k8s-networking) can express since it's identity- and L7-aware rather than IP-based.

## Sidecar mode, and its cost

The traditional model injects an Envoy sidecar into every Pod ([Multi-Container Patterns](/blog/k8s-multi-container-patterns)), with iptables rules redirecting all traffic through it.

It works, but the costs are real: an Envoy per Pod at ~50-100Mi and some CPU adds up fast across thousands of Pods; every Pod restart is now two containers; and sidecar startup/shutdown ordering caused genuine problems (an app starting before its proxy was ready, or the proxy dying first during termination and stranding in-flight requests). Native sidecar containers, stable since 1.29, fixed the ordering half of that ([Health & Lifecycle](/blog/k8s-health-lifecycle)).

## Ambient mode — sidecar-less, and now the default recommendation

Istio's **ambient mode reached GA in Istio 1.24** (November 2024) and is now the recommended starting point for new mesh deployments. It splits the data plane in two and removes sidecars entirely:

- **ztunnel** ("zero trust tunnel") — a **DaemonSet**, one per node, handling L4 concerns: mTLS, secure node-to-node tunneling over HBONE, and basic telemetry. This is the always-on baseline.
- **waypoint proxies** — optional, deployed **per namespace or per service**, only where you need L7 features (HTTP routing, traffic splitting, L7 authorization).

The consequence is a much better cost curve: you get mTLS and L4 telemetry across the whole mesh from a handful of node-level proxies instead of one proxy per Pod, and pay for L7 processing only where you actually use it — reported resource savings are substantial (commonly cited around 70% versus sidecars). It also means adopting the mesh incrementally: turn on L4 for a namespace by labeling it, add a waypoint later only if you need L7.

## Istio traffic objects

**VirtualService** — routing rules: where does a request for this host go?

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: api
spec:
  hosts: ["api"]
  http:
    - match:
        - headers:
            x-canary:
              exact: "true"
      route:
        - destination: { host: api, subset: v2 }
    - route:
        - destination: { host: api, subset: v1 }
          weight: 90
        - destination: { host: api, subset: v2 }
          weight: 10
      retries:
        attempts: 3
        perTryTimeout: 2s
```

**DestinationRule** — what happens *after* routing picks a destination: subset definitions (mapping `v1`/`v2` to label selectors), load balancing algorithm, connection pool limits, outlier detection (circuit breaking), and TLS settings.

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: api
spec:
  host: api
  trafficPolicy:
    connectionPool:
      http: { http2MaxRequests: 1000 }
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 30s
  subsets:
    - name: v1
      labels: { version: v1 }
    - name: v2
      labels: { version: v2 }
```

The division of labor: **VirtualService decides where traffic goes; DestinationRule decides how it's treated once the destination is chosen.** Subsets referenced in a VirtualService must be defined in a DestinationRule — a missing DestinationRule is the most common "my routing rule does nothing" cause.

Also note the **Gateway API** is increasingly the portable way to express this. Istio supports it for both ingress and east-west mesh traffic (the GAMMA initiative), so weighted routing written as an `HTTPRoute` works across implementations — worth preferring for new configuration over Istio-specific CRDs where the feature set allows.

## Traffic mirroring

Send a **copy** of live traffic to another version and discard the responses — the shadow/dark-launch strategy from [Deployment Strategies](/blog/k8s-deployment-strategies):

```yaml
  http:
    - route:
        - destination: { host: api, subset: v1 }
      mirror:
        host: api
        subset: v2
      mirrorPercentage:
        value: 10.0
```

The production path is entirely unaffected — responses from the mirrored version are dropped, and users only ever see `v1`. Repeating the essential caveat: this is only safe if the mirrored version has **no side effects**, or you've just doubled every write, email, and payment in production.

## The alternatives

**Linkerd** — deliberately simpler, uses a purpose-built lightweight Rust proxy instead of Envoy, less configurable but much less to operate. A reasonable choice when you want mTLS and basic reliability without Istio's surface area.

**Cilium Service Mesh** — eBPF-based, handles L4 in the kernel with no per-Pod proxy at all, and uses Envoy only where L7 is needed. Natural if you're already running Cilium as your CNI.

**Do you need one at all?** If the goal is only encryption in transit, mTLS via a mesh is one option but not the only one. If the goal is only retries and timeouts, application libraries do that fine. The mesh wins when you want these things *uniformly*, across many services and languages, enforced by infrastructure rather than convention.

## On EKS and AKS

Istio, Linkerd, and Cilium all install on either cluster unchanged — they're upstream projects, not cloud services. What each cloud adds:

- **EKS** — Istio via Helm is the common path. **AWS App Mesh (Envoy-based) has been deprecated**, so new work on AWS should go to Istio or Cilium rather than App Mesh. VPC Lattice covers some service-to-service connectivity use cases at the AWS-networking layer instead of the mesh layer.
- **AKS** — offers a **managed Istio-based service mesh add-on** (Microsoft installs and upgrades the control plane), which is a genuine operational advantage if you want Istio without owning `istiod` upgrades yourself.

One AWS-specific overlap worth knowing: with the VPC CNI giving Pods real VPC IPs and security groups for Pods available ([EKS Networking Deep Dive](/blog/eks-networking-vpc-cni-deep-dive)), some L4 segmentation people reach for a mesh to get is achievable with AWS-native primitives. That doesn't cover mTLS identity or L7 policy — but it's worth knowing before adopting a mesh solely for network segmentation.

---

*Next:* [Extending Kubernetes: CRDs, Operators, Admission Webhooks, and Finalizers](/blog/k8s-extensibility)
