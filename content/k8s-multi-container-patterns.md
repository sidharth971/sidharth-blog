---
title: "Multi-Container Pod Patterns: Sidecar, Ambassador, Adapter, and Init Containers"
slug: k8s-multi-container-patterns
category: Kubernetes
tags: kubernetes, k8s, sidecar, init-containers, patterns
excerpt: Why a Pod holds more than one container, the three classic co-located patterns, and how native sidecar containers (stable since 1.29) finally fixed the long-standing "sidecar keeps the Job running forever" problem.
status: published
---

*Post 3 of an 18-part Kubernetes concepts series.* ← [Scheduling Workloads](/blog/k8s-workload-scheduling) · → [Networking](/blog/k8s-networking)

A Pod can hold multiple containers precisely because they share a network namespace and can share volumes — they can talk over `localhost` and read each other's files. That shared context is the whole reason these patterns exist: they're for helper containers that are so tightly coupled to the main app that scheduling them separately would break the relationship.

The test for whether something belongs in the same Pod: **would it ever make sense to scale these independently?** If yes, they're separate Deployments talking over a Service. If no — if the helper is meaningless without this specific instance of the app — it's a second container in the same Pod.

## Init containers

Init containers run to **completion, in order, before** any app container starts. If one fails, the Pod restarts it (subject to `restartPolicy`) and app containers never start until all init containers have succeeded.

```yaml
spec:
  initContainers:
    - name: wait-for-db
      image: busybox:1.36
      command: ['sh', '-c', 'until nc -z db 5432; do sleep 2; done']
    - name: run-migrations
      image: myapp:1.4.0
      command: ['./migrate', 'up']
  containers:
    - name: app
      image: myapp:1.4.0
```

Typical uses: waiting on a dependency, running schema migrations, fetching config or secrets into a shared volume, setting kernel parameters with elevated privileges the main container shouldn't have. That last one is a real security win — the init container can be privileged and short-lived while the app container stays unprivileged.

## Sidecar

The most common pattern: a container that **augments** the main one — log shipping, metrics export, secret refreshing, a service mesh proxy. It runs alongside the app for the Pod's whole lifetime.

```yaml
spec:
  containers:
    - name: app
      image: myapp:1.4.0
      volumeMounts:
        - name: logs
          mountPath: /var/log/app
    - name: log-shipper
      image: fluent-bit:3.1
      volumeMounts:
        - name: logs
          mountPath: /var/log/app
          readOnly: true
  volumes:
    - name: logs
      emptyDir: {}
```

Historically sidecars were "just another entry in `containers`," which caused two well-known problems: no ordering guarantee (the app could start before the proxy was ready), and on a **Job**, a sidecar that never exits means the Job never completes.

**Native sidecar containers** (stable since Kubernetes 1.29) fix both. A sidecar is declared as an **init container with `restartPolicy: Always`** — which sounds odd but is precise: it starts *in the init sequence* (so it's up before app containers), keeps running alongside them, and is **excluded from Job completion logic**.

```yaml
spec:
  initContainers:
    - name: proxy
      image: envoy:1.31
      restartPolicy: Always      # <- this makes it a native sidecar
  containers:
    - name: app
      image: myapp:1.4.0
```

If you're running sidecars on Jobs or need startup ordering, this is the form to use.

## Ambassador

A proxy container that **brokers the app's outbound connections**. The app connects to `localhost` and the ambassador handles the messy part — service discovery, sharding, retries, TLS, connection pooling.

The canonical example is a database connection pooler or a Redis shard-router: the app opens a plain connection to `localhost:6379` with no awareness of sharding, and the ambassador routes to the right backend. This lets you change the topology of a dependency without touching application code or config.

## Adapter

The mirror image of the ambassador: it **normalizes the app's outward-facing interface** so the outside world sees a standard shape.

The classic case is metrics — an app emits some proprietary or legacy format, and an adapter container translates it into Prometheus exposition format on a standard `/metrics` endpoint. The monitoring system sees a uniform interface across a fleet of otherwise inconsistent applications, and nobody had to modify the legacy app.

The distinction worth keeping straight: **ambassador handles outbound** (app → world), **adapter handles inbound/observation** (world → app).

## When not to reach for these

Multi-container Pods share a lifecycle — they're scheduled together, scaled together, and die together. That coupling is the feature, but it's also the cost. Two containers that could reasonably be separate services, or that different teams own and want to deploy on different cadences, don't belong in one Pod just because it's convenient. And every sidecar multiplies with replica count: a sidecar using 100Mi across 200 Pods is 20Gi of cluster memory doing supporting work, which is exactly the argument behind service meshes moving toward sidecar-less data planes (covered in [Service Mesh](/blog/k8s-service-mesh)).

## On EKS and AKS

Pod-level patterns are pure upstream Kubernetes — identical on both, and unaffected by the managed control plane. Where the clouds show up is in *which* sidecars you end up running:

- **Secret injection** — on EKS, the Secrets Store CSI driver with the AWS provider mounts secrets as files (see [Accessing AWS Secrets Manager from EKS](/blog/accessing-aws-secrets-manager-from-eks-with-pod-identity-with-auto-sync)); AKS uses the same CSI driver with the Azure Key Vault provider. Same pattern, different provider plugin.
- **Log shipping** — a Fluent Bit sidecar (or, more often, a DaemonSet) targeting CloudWatch Logs on EKS vs. Azure Monitor / Log Analytics on AKS; see [Observability on EKS](/blog/eks-observability-cloudwatch-prometheus).
- **Service mesh proxies** — Istio/Envoy or App Mesh on EKS, Istio or the Azure Service Mesh add-on on AKS. Both are moving the same direction on sidecar overhead.

---

*Next:* [Kubernetes Networking: Services, Ingress, Gateway API, and NetworkPolicy](/blog/k8s-networking)
