---
title: "Observability in Kubernetes: Logs, Events, Metrics, and kubectl top"
slug: k8s-observability
category: Kubernetes
tags: kubernetes, k8s, observability, logging, events, metrics
excerpt: What Kubernetes gives you natively (less than people assume), why Events disappear after an hour, the difference between metrics-server and Prometheus, and the debugging order that actually finds problems fastest.
status: published
---

*Post 14 of an 18-part Kubernetes concepts series.* ← [Scheduling & Eviction](/blog/k8s-scheduling-eviction) · → [Helm](/blog/k8s-helm)

Kubernetes ships with far less observability than people expect. There's no built-in log aggregation, no metrics storage, no dashboards, and Events — the most useful debugging signal it *does* have — are deleted after an hour by default. Knowing exactly where the built-ins stop is what tells you what you actually have to add.

## Logs

The model is deliberately minimal: a container writes to **stdout/stderr**, the container runtime captures it, and the kubelet exposes it. That's the whole native story.

```bash
kubectl logs api-7d9f-x2k1
kubectl logs api-7d9f-x2k1 -c sidecar        # specific container
kubectl logs api-7d9f-x2k1 --previous        # the crashed instance
kubectl logs -f deploy/api                   # follow (one Pod)
kubectl logs -l app=api --tail=50 --prefix   # across Pods, prefixed with the source
```

`--previous` is the one that matters for crash loops — without it you're reading the current (just-started) container, which usually shows nothing.

The limits are the important part:

- **Logs are per-node files, rotated by the kubelet.** Once rotated out, `kubectl logs` can't reach them.
- **Delete the Pod, lose the logs.** Entirely. A crash-looping Pod that gets replaced takes its history with it.
- **No aggregation, no search, no retention.** Nothing spans Pods, nodes, or time.

Which is why cluster-level logging is always something you add: a **DaemonSet** (Fluent Bit, Vector, Promtail) on every node tailing the container log files and shipping them to a backend that actually stores and indexes them. That's a pattern, not a feature — Kubernetes provides no part of it.

Two application-side rules make it work: **log to stdout**, not to a file inside the container (a file nobody collects is a file nobody reads), and **log structured JSON**, so the backend can index fields instead of regex-matching prose.

## Events

Events are the cluster telling you what it *did* and why — and they're the fastest path to root cause for most Pod problems.

```bash
kubectl get events -n prod --sort-by=.lastTimestamp
kubectl get events -n prod --field-selector type=Warning
kubectl describe pod api-7d9f-x2k1        # events for this object, at the bottom
```

`kubectl describe` is usually the right entry point — it shows the object's events inline, which answers most questions immediately: `FailedScheduling` with a reason, `Failed` to pull an image, `Unhealthy` from a failing probe, `Killing` from a liveness restart, `Evicted` under node pressure.

The catch that surprises people: **Events are stored in etcd with a ~1 hour TTL by default.** They're not a log — they're a short-lived buffer. An incident investigated two hours later has no Events left. If Events matter to you (they should), ship them somewhere durable — most logging agents can collect the Events API, and there are purpose-built exporters.

Also note events are **namespaced** and, by default, `kubectl get events` shows only the current namespace. Cluster-level problems often surface in `kube-system`.

## Metrics: two different things

This distinction causes real confusion:

**metrics-server** — collects live CPU/memory from each kubelet, keeps only a short in-memory window, serves the Metrics API. Its purpose is **autoscaling decisions** ([Autoscaling](/blog/k8s-autoscaling)) and `kubectl top`. It has **no history** and is not a monitoring system.

**Prometheus** (or an equivalent) — scrapes `/metrics` endpoints, stores time series with retention, supports querying and alerting. This is your actual monitoring. Kubernetes ships none of it.

```bash
kubectl top nodes
kubectl top pods -n prod --sort-by=memory
kubectl top pods -n prod --containers        # per-container, not per-Pod
```

If `kubectl top` errors, metrics-server is missing or unhealthy — and HPA will be broken for the same reason.

The comparison worth internalizing: `kubectl top` shows **current usage**; it does not show requests, limits, or history. A Pod at 90% of its limit and a Pod at 90% of a node look identical here. For "is this Pod near its limit," compare against the spec (or use the VPA's recommendations); for "what happened at 3am," you need Prometheus.

What a real setup scrapes: **kube-state-metrics** (object state — replica counts, Pod phases, PVC status; distinct from resource usage), **node-exporter** (node-level OS metrics), the **kubelet/cAdvisor** endpoints (container resource usage), and control-plane component metrics.

## The debugging order

Most Pod problems resolve fastest in this sequence:

```bash
kubectl get pods -n prod                    # 1. what state is it in?
kubectl describe pod <name> -n prod         # 2. events + last state + exit code
kubectl logs <name> -n prod --previous      # 3. what did it say before dying?
kubectl get events -n prod --sort-by=.lastTimestamp   # 4. what else happened around it?
```

The state in step 1 usually narrows it immediately: `Pending` is a scheduling problem (step 2 tells you which constraint), `ImagePullBackOff` is registry/credentials, `CrashLoopBackOff` is the application (step 3), `OOMKilled` in the last state is [resource limits](/blog/k8s-resource-management), `Evicted` is [node pressure](/blog/k8s-scheduling-eviction).

For live debugging, `kubectl exec -it <pod> -- sh` works — until the image is distroless and has no shell. That's what **ephemeral debug containers** are for:

```bash
kubectl debug -it <pod> --image=busybox:1.36 --target=app
```

It attaches a temporary container to the running Pod, sharing the target's process namespace — so you get tooling without baking a shell into your production image.

## Traces, and the fourth pillar

Logs, events, and metrics tell you *what* happened in one place. They don't tell you where the time went across a request touching six services. That's **distributed tracing**, and like metrics storage, Kubernetes provides none of it — it's an application instrumentation concern, standardized these days on **OpenTelemetry**, exporting to a backend (Jaeger, Tempo, or a cloud service).

## On EKS and AKS

The upstream commands and objects are identical. The difference is what's **already wired up** and where telemetry lands:

| | EKS | AKS |
|---|---|---|
| Container metrics/logs | CloudWatch Observability add-on (ADOT collector under the hood) | Azure Monitor / Container Insights add-on |
| Managed Prometheus | Amazon Managed Service for Prometheus | Azure Monitor managed Prometheus |
| Managed Grafana | Amazon Managed Grafana | Azure Managed Grafana |
| Control plane logs | Opt-in per type → CloudWatch Logs | Diagnostic settings → Log Analytics |
| metrics-server | Install it yourself | Preinstalled |

Two practical notes. First, **control plane logs are opt-in on both** and cost money per type — the audit log is the one to enable deliberately, since it's what answers "who deleted this Secret" and it's useless to enable *after* you need it ([Cluster Architecture](/blog/k8s-cluster-architecture)).

Second, both clouds' native stacks are now **OpenTelemetry-based underneath**, which makes the instrumentation portable even though the backends aren't. The AWS-side specifics — the managed add-on, Container Insights, and where Prometheus still earns its place over CloudWatch — are in [Observability on EKS](/blog/eks-observability-cloudwatch-prometheus).

---

*Next:* [Helm: Charts, Templates, Values, and Releases](/blog/k8s-helm)
