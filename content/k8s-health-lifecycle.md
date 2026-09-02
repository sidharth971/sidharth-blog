---
title: "Pod Health and Lifecycle: Probes, Hooks, Phases, and Graceful Termination"
slug: k8s-health-lifecycle
category: Kubernetes
tags: kubernetes, k8s, probes, lifecycle, graceful-shutdown, restartpolicy
excerpt: The three probes and what each one actually controls, Pod phases vs container states, restartPolicy, and the termination sequence — including the endpoint-removal race that causes dropped requests on every deploy.
status: published
---

*Post 11 of an 18-part Kubernetes concepts series.* ← [Deployment Strategies](/blog/k8s-deployment-strategies) · → [Cluster Architecture](/blog/k8s-cluster-architecture)

Kubernetes decides whether to restart your container, whether to send it traffic, and how long to wait before killing it. All three are configurable, all three have sensible-looking defaults that are wrong for most real applications, and getting them wrong is the most common cause of "our rolling deploys drop requests."

## Pod phases and container states

Two different things people conflate. The Pod **phase** is a coarse summary:

- **Pending** — accepted, but not running yet: still scheduling, or pulling images.
- **Running** — bound to a node, at least one container running.
- **Succeeded** — all containers exited 0 and won't restart (Jobs).
- **Failed** — all containers terminated, at least one failed.
- **Unknown** — the node stopped reporting.

Container **states** are finer-grained and more useful for debugging: `Waiting` (with a reason like `ImagePullBackOff` or `CrashLoopBackOff`), `Running`, `Terminated` (with exit code and reason).

`CrashLoopBackOff` isn't a state so much as a message: the container keeps exiting and the kubelet is applying exponential backoff between restarts (10s, 20s, 40s… capped at 5 minutes). The exit code narrows it fast — `137` is SIGKILL (usually OOMKilled, see [Resource Management](/blog/k8s-resource-management)), `143` is SIGTERM, `1` is a plain application error.

```bash
kubectl describe pod <name>              # events + last state + exit code
kubectl logs <name> --previous           # logs from the crashed instance
```

`--previous` is the important one — without it you get the logs of the *current* attempt, which has usually just started and shows nothing useful.

## restartPolicy

Pod-level, applies to all containers:

- **Always** (default) — restart regardless of exit code. Required for Deployments/StatefulSets/DaemonSets.
- **OnFailure** — restart only on non-zero exit. Typical for Jobs.
- **Never** — never restart.

Note that "restart" means the kubelet restarts the container **in the same Pod on the same node** — it does not reschedule. A Pod stuck on a broken node keeps crash-looping there; nothing moves it.

## Liveness probe — "should I kill this?"

Fails → the kubelet **kills and restarts** the container.

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

Liveness is for **unrecoverable** states only — a deadlocked process, an event loop that's wedged. It exists to fix "the process is up but permanently stuck."

The classic mistake is making it too smart: a liveness endpoint that checks the database means a brief database blip restarts every replica simultaneously, turning a small dependency hiccup into a full outage. **Liveness should test the process, not its dependencies.** Dependency health belongs in readiness.

The second mistake is being too aggressive — a probe that times out under load restarts a container that was merely busy, which removes capacity exactly when you need it most.

## Readiness probe — "should I send traffic?"

Fails → the Pod is removed from Service endpoints. It is **not** killed.

```yaml
readinessProbe:
  httpGet:
    path: /ready
    port: 8080
  periodSeconds: 5
  failureThreshold: 3
```

This is the probe that matters most, and the one most often missing. Without it, a Pod is considered ready the instant the container starts — so a rolling update ([Deployment Strategies](/blog/k8s-deployment-strategies)) terminates an old Pod and routes traffic to a new one that hasn't finished booting. Most "deploys cause 502s" reports are exactly this.

Unlike liveness, readiness **should** check dependencies — if the database is unreachable, this replica genuinely can't serve requests, and removing it from rotation (without killing it) is the correct response. When the dependency recovers, it re-enters rotation automatically.

## Startup probe — "has it finished booting?"

Disables liveness and readiness until it succeeds once.

```yaml
startupProbe:
  httpGet:
    path: /healthz
    port: 8080
  periodSeconds: 10
  failureThreshold: 30       # up to 300s to start
```

This solves a real conflict: a slow-starting application (a JVM warming up, a large cache load) needs a generous liveness timeout to survive boot — but a generous timeout means slow detection of genuine hangs later. A startup probe lets you have both: a long grace period during startup (`failureThreshold × periodSeconds`), then tight liveness checks for the rest of the Pod's life.

Prefer this over inflating `initialDelaySeconds` on the liveness probe.

## Probe types

All three probes support the same handlers: `httpGet` (2xx/3xx is success), `tcpSocket` (connection opens), `exec` (command exits 0), and `grpc` (native gRPC health checking protocol).

`exec` probes are the expensive one — they fork a process in the container on every check, which at scale is real overhead. Prefer `httpGet` when the app can expose an endpoint.

## Lifecycle hooks: postStart and preStop

```yaml
lifecycle:
  postStart:
    exec:
      command: ["/bin/sh", "-c", "echo started >> /var/log/lifecycle"]
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 15"]
```

**postStart** runs immediately after container creation — but with **no ordering guarantee** relative to the container's entrypoint. It may run before the app's first line executes. If the container blocks on postStart failing, the container is restarted. Use sparingly; init containers ([Multi-Container Patterns](/blog/k8s-multi-container-patterns)) are usually the better tool.

**preStop** runs *before* SIGTERM is sent, and the container isn't signalled until it completes (or the grace period expires). This is the hook that matters, for the reason below.

## Graceful termination — and the endpoint race

The termination sequence, in order:

1. Pod marked `Terminating`; deletion timestamp set.
2. **Two things happen concurrently**: the Pod is removed from Service endpoints, *and* the preStop hook runs (then SIGTERM is sent).
3. Application gets `terminationGracePeriodSeconds` (default **30**) to finish in-flight work and exit.
4. Anything still running gets **SIGKILL**.

Step 2 is the problem. Endpoint removal is **not** synchronous — it propagates asynchronously to kube-proxy on every node, to ingress controllers, to load balancers. Meanwhile the app has already received SIGTERM and may have stopped accepting connections. In that window, traffic is still being sent to a Pod that's already shutting down. Result: dropped requests on every single deploy, scale-down, and node drain.

The standard mitigation is a `preStop` sleep — delay SIGTERM long enough for endpoint removal to propagate:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 15"]
terminationGracePeriodSeconds: 45     # must exceed preStop + real drain time
```

During the sleep the Pod keeps serving normally (it hasn't been signalled yet) while its endpoints are withdrawn everywhere. Note `terminationGracePeriodSeconds` must comfortably exceed the preStop duration *plus* the app's own drain time — the grace period covers the whole sequence, not just the post-SIGTERM part.

The other half is the application itself: it must **handle SIGTERM** — stop accepting new connections, finish in-flight requests, close cleanly. A process that ignores SIGTERM gets SIGKILLed after the grace period, mid-request, on every routine deploy.

One note for sidecars: **native sidecar containers** (init containers with `restartPolicy: Always`, stable since 1.29) are terminated **after** the main containers, which fixes the old problem of a proxy sidecar dying first and stranding the app's in-flight requests with no network path out.

## On EKS and AKS

Probes, hooks, phases, and the termination sequence are pure upstream — identical on both. What differs is how quickly the **external load balancer** learns a Pod is gone, which determines how much preStop delay you actually need:

- **EKS** — with `target-type: ip`, the ALB/NLB targets pod IPs directly, so deregistration is an ALB-level operation with its own delay. The AWS Load Balancer Controller supports **pod readiness gates**, which extend Pod readiness to include *target group health* — closing the reverse race on startup (traffic sent before the LB has registered the target). Covered in [Load Balancing and Ingress on EKS](/blog/eks-load-balancing-ingress-alb-nlb-gateway-api).
- **AKS** — Azure Load Balancer and the Application Routing add-on have equivalent propagation delays; the same preStop-sleep pattern applies.

On both, node-level events (autoscaler consolidation, node upgrades, spot/eviction reclaim) trigger this same drain path far more often than deploys do — which is exactly why graceful shutdown is load-bearing rather than a nicety, as covered in [Reliability and Operations on EKS](/blog/eks-reliability-operations).

---

*Next:* [Cluster Architecture: Control Plane, etcd, kubelet, and the Runtime](/blog/k8s-cluster-architecture)
