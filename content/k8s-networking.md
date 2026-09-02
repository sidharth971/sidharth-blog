---
title: "Kubernetes Networking: Services, Ingress, Gateway API, NetworkPolicy, and CoreDNS"
slug: k8s-networking
category: Kubernetes
tags: kubernetes, k8s, networking, services, ingress, networkpolicy, coredns
excerpt: How traffic actually reaches a Pod — the four Service types and when each applies, headless Services, Ingress vs the now-GA Gateway API, default-allow networking and NetworkPolicy, plus what EndpointSlices and CoreDNS are doing underneath.
status: published
---

*Post 4 of an 18-part Kubernetes concepts series.* ← [Multi-Container Patterns](/blog/k8s-multi-container-patterns) · → [Configuration](/blog/k8s-configuration)

Pods are mortal and get new IPs every time they're replaced ([Core Objects](/blog/k8s-core-objects)). Everything in this post exists to solve the problem that creates: how does anything reliably reach a workload whose IPs keep changing?

## Service — a stable address in front of moving Pods

A Service gives a set of Pods one stable virtual IP and DNS name. It selects Pods by label, and the set of backing IPs updates automatically as Pods come and go.

### ClusterIP (the default)

Reachable only from **inside** the cluster. This is the right type for the overwhelming majority of Services — anything that isn't deliberately exposed externally.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: api
spec:
  type: ClusterIP
  selector:
    app: api
  ports:
    - port: 80          # the Service port
      targetPort: 8080  # the container port
```

Other Pods reach it at `api`, `api.default`, or the fully qualified `api.default.svc.cluster.local`.

### NodePort

Opens the same port on **every node** (default range 30000–32767) and forwards to the Service. Reachable at `<any-node-ip>:<nodePort>`. Useful for bare-metal, local development, or as a building block underneath a cloud load balancer — awkward as a production front door on its own, because callers need to know node IPs and the ports are non-standard.

### LoadBalancer

Provisions an external load balancer through the cloud provider and points it at the Service. It's a superset — a LoadBalancer Service is also a NodePort, which is also a ClusterIP.

The practical caveat: it's **one load balancer per Service**, which gets expensive fast. That's exactly the problem Ingress solves.

### ExternalName

The odd one out — no proxying, no selector, no endpoints. It's a CNAME: `db.default.svc.cluster.local` resolves to `mydb.abc123.us-east-1.rds.amazonaws.com`. Useful for giving an external dependency a stable in-cluster name so applications don't hardcode a provider endpoint.

## Headless Service

Set `clusterIP: None` and the Service stops load balancing entirely. Instead of one virtual IP, DNS returns **the individual Pod IPs**.

```yaml
spec:
  clusterIP: None
  selector:
    app: db
```

That's what StatefulSets need: `db-0.db.default.svc.cluster.local` addresses a *specific* Pod, which is essential for clustered software where clients must reach a particular member (a primary, a specific shard) rather than a random one.

## Ingress and Ingress controllers

An **Ingress** is an HTTP(S) routing rule set — host and path based — that lets many Services share one entry point.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
spec:
  ingressClassName: nginx
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 80
```

The crucial point: **the Ingress object does nothing by itself.** It's inert configuration. An **Ingress controller** — a Pod running in your cluster watching for Ingress objects — is what actually implements the routing. No controller installed means your Ingress silently does nothing.

Worth knowing in 2026: **ingress-nginx reached end-of-life in March 2026**, which has pushed a large number of clusters to migrate — mostly toward Gateway API implementations.

## Gateway API

Gateway API is the successor to Ingress, and it's **GA** — it addresses Ingress's two structural weaknesses: limited expressiveness (everything beyond basic host/path routing had to go in vendor-specific annotations) and no role separation (one object mixed infrastructure and application concerns).

It splits into layered resources:
- **GatewayClass** — the implementation (like a StorageClass, but for gateways).
- **Gateway** — the actual listener/infrastructure, owned by platform teams.
- **HTTPRoute / TCPRoute / GRPCRoute** — routing rules, owned by application teams, attached to a Gateway.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: api-route
spec:
  parentRefs:
    - name: prod-gateway
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api
      backendRefs:
        - name: api
          port: 80
          weight: 90
        - name: api-canary
          port: 80
          weight: 10
```

Native weighted traffic splitting — the thing that required annotations or a service mesh under Ingress — is just a field. That makes canary releases substantially simpler ([Deployment Strategies](/blog/k8s-deployment-strategies)).

Existing Ingress setups keep working and aren't urgent to migrate; new setups should default to Gateway API.

## NetworkPolicy

By default, Kubernetes networking is **completely flat**: any Pod can reach any other Pod, in any namespace. NetworkPolicy restricts that — but with two properties people get wrong:

1. **Policies are additive allow-lists.** Once *any* policy selects a Pod, that Pod is default-deny for the direction(s) the policy covers, and only explicitly allowed traffic passes.
2. **The CNI plugin must implement it.** A NetworkPolicy in a cluster whose CNI ignores them is a silent no-op — the object exists, nothing enforces it.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-allow-frontend
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
```

The standard hardening move is a per-namespace default-deny policy, then explicit allows on top:

```yaml
spec:
  podSelector: {}                 # every Pod in the namespace
  policyTypes: [Ingress, Egress]  # deny both directions by default
```

## DNS and CoreDNS

**CoreDNS** runs as a Deployment in `kube-system` and serves cluster DNS. Every Service gets an A record; every Pod's `/etc/resolv.conf` points at the DNS Service.

The naming scheme is `<service>.<namespace>.svc.cluster.local`, and `resolv.conf` search domains are why `api` resolves from within the same namespace while `api.other-ns` is needed across namespaces.

Two operational notes worth carrying: DNS is one of the first things to check when "everything is intermittently slow" (`kubectl -n kube-system logs -l k8s-app=kube-dns`), and CoreDNS needs to scale with cluster size — it's a frequent bottleneck on large clusters that nobody thinks to look at.

## Endpoints and EndpointSlices

When a Service selects Pods, something has to track *which IPs currently back it*. That used to be a single **Endpoints** object per Service — which became a scaling problem, since any Pod change rewrote one object listing every backend, and that update fanned out to every node.

**EndpointSlices** replaced it: the backend list is sharded across multiple smaller objects (100 endpoints each by default), so a change updates one slice instead of one enormous object. EndpointSlices are the current mechanism; `Endpoints` is legacy and effectively deprecated. You rarely touch either directly, but `kubectl get endpointslices` is the correct way to answer "is my Service actually pointing at any Pods?" — an empty result almost always means a selector that doesn't match your Pod labels.

## On EKS and AKS

Networking is where managed Kubernetes diverges most, since it's the layer wired directly into cloud VPC/VNet primitives:

| | EKS | AKS |
|---|---|---|
| CNI | AWS VPC CNI — Pods get real VPC IPs | Azure CNI (VNet IPs) or kubenet/Overlay |
| LoadBalancer Service | NLB via AWS Load Balancer Controller | Azure Load Balancer |
| Ingress | AWS Load Balancer Controller → ALB | Application Routing add-on (managed NGINX), App Gateway |
| NetworkPolicy engine | Calico or Cilium (VPC CNI needs one added) | Azure NPM, or Cilium via Azure CNI Powered by Cilium |

The VPC-native IP model has a real consequence covered in [EKS Networking Deep Dive](/blog/eks-networking-vpc-cni-deep-dive): Pod density per node is bounded by ENI/IP limits, not just CPU and memory — the kind of constraint that doesn't exist in an overlay-network cluster. The AWS side of Ingress, target types, and Gateway API support is in [Load Balancing and Ingress on EKS](/blog/eks-load-balancing-ingress-alb-nlb-gateway-api).

---

*Next:* [Configuration: ConfigMaps, Secrets, and the Downward API](/blog/k8s-configuration)
