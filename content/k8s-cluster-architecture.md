---
title: "Kubernetes Cluster Architecture: Control Plane, etcd, kubelet, and the Container Runtime"
slug: k8s-cluster-architecture
category: Kubernetes
tags: kubernetes, k8s, control-plane, etcd, kubelet, containerd
excerpt: What each component actually does and where it runs — the API server as the only thing that talks to etcd, controllers as reconciliation loops, kubelet as the node-level agent, and why kube-proxy's default is still iptables even though nftables is GA.
status: published
---

*Post 12 of an 18-part Kubernetes concepts series.* ← [Health & Lifecycle](/blog/k8s-health-lifecycle) · → [Scheduling & Eviction](/blog/k8s-scheduling-eviction)

Everything in this series so far is an object you submit. This post is what actually receives it, stores it, decides where it goes, and makes it real on a machine. On a managed cluster most of this is invisible — which is precisely why it's worth understanding when something breaks.

The split: **control plane** components make global decisions; **node** components run on every worker and manage what's actually executing there.

## kube-apiserver

The front door, and the only component that talks to **etcd**. Everything else — kubectl, controllers, the scheduler, kubelets — goes through the API server. That's a deliberate design property: one place to enforce authentication, authorization ([Security & RBAC](/blog/k8s-security-rbac)), admission control, and validation.

The request path for anything you submit:

1. **Authentication** — who is this? (certs, tokens, OIDC)
2. **Authorization** — are they allowed? (RBAC)
3. **Admission control** — mutating webhooks (defaulting, injection), then validating webhooks and built-ins like Pod Security Admission
4. **Validation & persistence** — schema check, write to etcd

It's stateless, so it scales horizontally — multiple replicas behind a load balancer, all talking to the same etcd.

## etcd

The **only** stateful component: a distributed key-value store holding the entire cluster state. Every object you've ever created lives here. Lose etcd without a backup and the cluster is gone — the workloads may keep running, but nothing can be reconciled, scheduled, or recovered.

Two properties worth knowing:

**Quorum.** etcd uses Raft consensus and needs a majority to accept writes. That's why member counts are **odd** — 3 members tolerate 1 failure, 5 tolerate 2. A 4-member cluster tolerates the same single failure as 3, with more overhead. Lose quorum and the cluster goes **read-only**.

**Watch.** Clients don't poll — they open watches and get streamed changes. This is the mechanism the entire controller model rests on.

Backups are the thing to actually get right on a self-managed cluster: `etcdctl snapshot save`, stored somewhere off-cluster, and *tested by restoring*. Encryption at rest is separate and off by default ([Security & RBAC](/blog/k8s-security-rbac)).

## kube-scheduler

Watches for Pods with no `nodeName` and assigns each one to a node, in two phases:

1. **Filtering** — which nodes *can* run this Pod? (enough allocatable resources, matching nodeSelector/affinity, tolerates taints, required volumes attachable)
2. **Scoring** — of the feasible nodes, which is *best*? (spreading, image locality, affinity preferences, resource balance)

Highest score wins; the scheduler writes the binding and its job ends. It does **not** start the container — the kubelet does, once it sees a Pod bound to its node.

Critically, scheduling is a **one-time decision**. The scheduler never moves a running Pod because a better node appeared later. Rebalancing requires something else to evict Pods (the descheduler, Karpenter consolidation), after which the scheduler places the replacements.

Everything shaping these decisions — affinity, taints, topology spread, priority — is [Scheduling Workloads](/blog/k8s-workload-scheduling).

## kube-controller-manager

A single binary running many **controllers**, each an independent reconciliation loop with the same shape:

> observe actual state → compare to desired state → act to close the gap → repeat, forever

Deployment controller (manages ReplicaSets), ReplicaSet controller (manages Pods), Node controller (marks nodes unhealthy, evicts Pods after a timeout), Job controller, endpoints/EndpointSlice controllers, ServiceAccount controller, and more.

This reconciliation model is *the* core idea in Kubernetes. It's also exactly what a custom Operator implements for your own resources ([Extensibility](/blog/k8s-extensibility)) — same pattern, your logic.

## cloud-controller-manager

The cloud-specific controllers, deliberately split out of the main controller manager so Kubernetes core has no vendor code in it. It handles:

- **Node controller** — labels nodes with region/zone/instance type, and detects when a VM has actually been deleted at the cloud provider.
- **Service controller** — provisions the cloud load balancer for `type: LoadBalancer` Services ([Networking](/blog/k8s-networking)).
- **Route controller** — configures cloud network routes where the CNI needs it.

On EKS and AKS this is entirely managed for you — but it's the component doing the work when a `LoadBalancer` Service magically produces an actual cloud load balancer.

## kubelet

The agent on **every node**. It watches the API server for Pods bound to its node, then makes them real:

- Pulls images and instructs the container runtime to start/stop containers
- Mounts volumes ([Storage](/blog/k8s-storage))
- Runs **probes** and acts on the results ([Health & Lifecycle](/blog/k8s-health-lifecycle))
- Reports node and Pod status back to the API server
- Enforces **evictions** under node pressure ([Scheduling & Eviction](/blog/k8s-scheduling-eviction))
- Runs **static Pods** from a local manifest directory — no API server involved, which is how self-managed control planes bootstrap themselves

The kubelet is the one component that manages containers directly. It's also why a node with a healthy kubelet but a broken runtime looks confusingly half-working.

## kube-proxy

Implements the **Service** abstraction on each node: turning a Service's virtual IP into actual routing to backend Pod IPs, kept in sync from EndpointSlices.

Three modes, and the current state is worth being precise about:

- **iptables** — the long-standing **default**. Rule evaluation is effectively linear, so it degrades on very large Services.
- **IPVS** — kernel-native load balancing with better scaling and real algorithms (round-robin, least-connection).
- **nftables** — **GA since Kubernetes 1.33**, and outperforms both on large clusters. Requires kernel 5.13+. Note that **iptables is still the upstream default** for compatibility; switching the default to nftables is planned for a future release but hasn't happened yet.

Many CNIs now **replace kube-proxy entirely** — Cilium's eBPF datapath being the common example, handling Service routing in eBPF rather than through any of these modes.

## Container runtime (containerd, CRI-O)

The kubelet doesn't run containers itself; it talks to a runtime over the **Container Runtime Interface (CRI)**.

- **containerd** — the most common, and the default on both major managed offerings.
- **CRI-O** — purpose-built for Kubernetes, standard on OpenShift.

**Docker is no longer a supported runtime.** Dockershim — the shim letting the kubelet talk to Docker — was **removed in Kubernetes 1.24**. This caused more panic than it warranted: Docker-*built* images are OCI images and run fine everywhere. Only the runtime changed.

Underneath, both use **runc** to actually create the container (namespaces, cgroups). Sandboxed alternatives exist for stronger isolation: gVisor (userspace kernel) and Kata Containers (lightweight VMs).

## Putting it together: what happens on `kubectl apply`

1. `kubectl` sends the Deployment to the **API server**
2. Authn → authz → admission → validation → **etcd**
3. **Deployment controller** sees it, creates a ReplicaSet
4. **ReplicaSet controller** creates Pod objects (no node assigned)
5. **Scheduler** filters and scores nodes, binds each Pod
6. **kubelet** on that node sees the binding, pulls images, tells **containerd** to start containers, mounts volumes, starts probes
7. Once readiness passes, endpoint controllers add the Pod to EndpointSlices; **kube-proxy** on every node programs the routing

Every arrow is a watch-driven reconciliation loop, not a synchronous call chain. That's why Kubernetes is resilient to any single component being briefly down — and why nothing happens *instantly*.

## On EKS and AKS

Both run the **entire control plane as a managed service**: API server, etcd, scheduler, controller manager, and cloud-controller-manager are AWS's or Microsoft's responsibility, across multiple AZs, patched and scaled without you. You cannot SSH to them or edit their flags.

What that means practically:

| | EKS | AKS |
|---|---|---|
| Control plane | Managed, multi-AZ, in an AWS-owned VPC | Managed; free tier has no SLA, Standard tier adds one |
| Control plane logs | Opt-in per type to CloudWatch (api, audit, authenticator, …) | Opt-in diagnostic settings to Log Analytics |
| etcd access | None — snapshots/restore are AWS's job | None |
| Node components | kubelet, kube-proxy, containerd on your nodes | Same |
| API server config | Limited to documented settings | Limited to documented settings |

**You still own the node components.** kubelet, kube-proxy, and containerd run on your worker nodes, and their versions must stay compatible with the control plane version — which is exactly why upgrades are two-phase (control plane first, then nodes), as covered in [EKS Cluster Provisioning & Architecture](/blog/eks-cluster-provisioning-architecture).

The audit log deserves a specific mention: it's off by default on both, and it's the component that answers "who deleted this?" after the fact. Enabling it before you need it is the whole point.

---

*Next:* [The Scheduler, Eviction, Node Pressure, PDBs, and Draining Nodes](/blog/k8s-scheduling-eviction)
