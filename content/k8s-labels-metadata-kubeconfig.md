---
title: "Labels, Annotations, Owner References, Field Selectors, and kubeconfig"
slug: k8s-labels-metadata-kubeconfig
category: Kubernetes
tags: kubernetes, k8s, labels, annotations, kubeconfig, multi-tenancy
excerpt: The metadata layer that everything else selects on — labels vs annotations, owner references and cascading deletion, field selectors, kubeconfig contexts, feature gates, and what multi-tenancy actually requires.
status: published
---

*Post 18 of an 18-part Kubernetes concepts series.* ← [Extensibility](/blog/k8s-extensibility)

The final post, on the connective tissue: how objects reference each other, how you select them, and how you connect to clusters. None of it is glamorous, and all of it is load-bearing — a typo in a label selector is the single most common reason a Service routes to nothing.

## Labels and selectors

**Labels** are key-value pairs used for **identification and selection**. They're indexed, queryable, and the mechanism by which nearly everything in Kubernetes finds anything else.

```yaml
metadata:
  labels:
    app.kubernetes.io/name: api
    app.kubernetes.io/instance: api-prod
    app.kubernetes.io/version: "1.9.2"
    app.kubernetes.io/component: backend
    app.kubernetes.io/managed-by: helm
    environment: production
```

The `app.kubernetes.io/*` prefixes are the **recommended common labels** — worth adopting because tooling (dashboards, Helm, monitoring) understands them, rather than each team inventing `service:` vs `svc:` vs `application:`.

Selectors come in two forms. Equality-based:

```bash
kubectl get pods -l environment=production,tier=backend
kubectl get pods -l environment!=staging
```

And set-based:

```bash
kubectl get pods -l 'environment in (production, staging)'
kubectl get pods -l 'tier notin (frontend)'
kubectl get pods -l 'app.kubernetes.io/name'          # key exists
kubectl get pods -l '!deprecated'                      # key does not exist
```

Selectors are what connect the objects covered across this series: Services select Pods, Deployments select their ReplicaSets' Pods, NetworkPolicies select both subjects and peers, PDBs select the workload they protect, topology spread constraints select the group to spread.

Two hard rules that bite people:

- **A Deployment's `spec.selector` is immutable.** Once created you cannot change it — you delete and recreate the Deployment. Choose it deliberately.
- **A Service selecting nothing fails silently.** No error, just no endpoints and connection failures. `kubectl get endpointslices -l kubernetes.io/service-name=<svc>` is the direct check ([Networking](/blog/k8s-networking)).

## Annotations

**Annotations** are also key-value metadata, but for **non-identifying** information — you cannot select on them. They hold arbitrary data, including large or structured values that labels can't (labels are capped at 63 characters and restricted in charset).

```yaml
metadata:
  annotations:
    kubernetes.io/change-cause: "rollout 1.9.2 — fixes ORD-4471"
    prometheus.io/scrape: "true"
    prometheus.io/port: "9090"
    service.beta.kubernetes.io/aws-load-balancer-type: "external"
```

The distinction in one line: **labels are for Kubernetes to find things; annotations are for tools and humans to attach information to things.**

In practice, annotations are the primary configuration channel for controllers. Ingress controllers, cert-manager, external-dns, and cloud load balancer integrations are all driven by annotations — which is precisely the sprawl Gateway API was designed to replace with typed fields ([Networking](/blog/k8s-networking)).

## Owner references and cascading deletion

**Owner references** record parent-child relationships, and they're how deleting a Deployment deletes its Pods rather than orphaning them.

```yaml
metadata:
  ownerReferences:
    - apiVersion: apps/v1
      kind: ReplicaSet
      name: api-7d9f8b
      uid: 3f2a...
      controller: true
      blockOwnerDeletion: true
```

The chain from [Core Objects](/blog/k8s-core-objects): Deployment → ReplicaSet → Pod, each level owning the next. Delete the Deployment and **garbage collection** removes everything beneath it.

Three deletion propagation policies:

```bash
kubectl delete deployment api                                # Background (default)
kubectl delete deployment api --cascade=foreground           # children first, then parent
kubectl delete deployment api --cascade=orphan               # keep the Pods running
```

`--cascade=orphan` is occasionally genuinely useful — replacing a controller while leaving its workload untouched — but the orphaned Pods now belong to nothing and won't be recreated if they die.

One constraint that surprises people: **owner references cannot cross namespaces**, and a namespaced object cannot own a cluster-scoped one. Operators managing cluster-scoped resources have to handle that cleanup with [finalizers](/blog/k8s-extensibility) instead.

## Field selectors

Where label selectors filter on labels you set, **field selectors** filter on the object's own fields:

```bash
kubectl get pods --field-selector status.phase=Running
kubectl get pods --field-selector spec.nodeName=node-1
kubectl get events --field-selector type=Warning,involvedObject.kind=Pod
kubectl get pods --field-selector metadata.namespace!=kube-system -A
```

The catch: only a **limited, per-resource set of fields** is supported (mostly `metadata.name`, `metadata.namespace`, and a few indexed fields like `status.phase` and `spec.nodeName`). Arbitrary field paths aren't queryable — for anything else you filter client-side with `jq` or `-o jsonpath`. `kubectl get events --field-selector` is the one most worth remembering, since events are otherwise noisy ([Observability](/blog/k8s-observability)).

## kubeconfig and contexts

A **kubeconfig** file ties together three lists — clusters (API server URL + CA), users (credentials), and **contexts** (a cluster + user + default namespace triple).

```yaml
contexts:
  - name: prod-eks
    context:
      cluster: prod-eks-cluster
      user: prod-admin
      namespace: default
current-context: prod-eks
```

```bash
kubectl config get-contexts
kubectl config use-context staging
kubectl config set-context --current --namespace=prod
kubectl config view --minify                     # just the current context
```

Defaults to `~/.kube/config`, overridable with `$KUBECONFIG` (which accepts a **colon/semicolon-separated list** that gets merged — handy for keeping one file per cluster rather than one giant file).

The safety point worth stating plainly: `current-context` is **global to your shell environment**, so "I thought I was on staging" is a real and common production incident. Tools like `kubectx`/`kubens` and a shell prompt that displays the current context (via `kube-ps1` or starship) are cheap insurance. For genuinely dangerous clusters, a separate `KUBECONFIG` per terminal beats switching contexts in a shared one.

## Feature gates

**Feature gates** are per-component flags controlling alpha/beta features on the API server, kubelet, scheduler, and controller manager. They're how features graduate: alpha (off by default, may break) → beta (on by default in recent versions) → GA (always on, gate eventually removed).

This series has touched several mid-graduation examples: in-place Pod resize (GA in 1.35) with VPA's `InPlaceOrRecreate` still alpha ([Autoscaling](/blog/k8s-autoscaling)), and kube-proxy's nftables mode GA in 1.33 but still not the default ([Cluster Architecture](/blog/k8s-cluster-architecture)).

The managed-cluster reality: **you generally cannot set arbitrary feature gates on EKS or AKS**, since you don't control control-plane flags. Which features are available is a function of the cluster's Kubernetes version and what the provider enables — so "just turn on the feature gate" often isn't an option, and the answer is upgrading the cluster version instead.

## Multi-tenancy

Sharing one cluster between teams uses essentially every mechanism in this series, layered:

- **Namespaces** — the scoping boundary ([Core Objects](/blog/k8s-core-objects))
- **RBAC** — who can do what, scoped per namespace ([Security & RBAC](/blog/k8s-security-rbac))
- **ResourceQuota / LimitRange** — no team starves another ([Resource Management](/blog/k8s-resource-management))
- **NetworkPolicy** — default-deny between namespaces ([Networking](/blog/k8s-networking))
- **Pod Security Admission** — no privileged escapes
- **Node isolation** — taints and tolerations, or separate node pools, for tenants needing dedicated compute ([Scheduling Workloads](/blog/k8s-workload-scheduling))

The honest caveat: this is **soft multi-tenancy**. Namespaces don't isolate the kernel — tenants still share nodes, the kernel, and the control plane. A container escape crosses namespace boundaries trivially. For genuinely untrusted workloads (running arbitrary customer code), you need sandboxed runtimes (gVisor, Kata) or, more realistically, **separate clusters**. "One cluster per team" is often the cheaper answer than getting hard multi-tenancy right on a shared one.

## On EKS and AKS

Labels, annotations, owner references, and field selectors are pure upstream. The cloud-specific parts are kubeconfig generation and cluster-scoped tenancy decisions:

```bash
aws eks update-kubeconfig --name prod-cluster --region us-east-1
az aks get-credentials --resource-group rg-prod --name prod-cluster
```

Both write a context whose credentials are **short-lived tokens issued by the cloud IdP**, not static certificates — so cluster access follows cloud IAM. On EKS that's access entries mapped to RBAC groups; on AKS it's Entra ID with either Azure RBAC for Kubernetes or native Kubernetes RBAC ([EKS Identity & Access](/blog/eks-identity-access-irsa-pod-identity-rbac)).

Annotations remain the main cloud-integration surface on both — `service.beta.kubernetes.io/aws-load-balancer-*` on EKS, `service.beta.kubernetes.io/azure-load-balancer-*` on AKS — which is a concrete illustration of why Gateway API's typed fields are an improvement over annotation dialects that don't transfer between clouds.

## That's the series

Eighteen posts, from what a Pod is through to how you extend the API and connect to the cluster. The through-line worth carrying: **almost everything here is portable.** The objects, selectors, scheduling controls, probes, RBAC model, and extension mechanisms are identical on EKS, AKS, GKE, and a laptop running kind. What changes between them is the layer underneath — how nodes appear, how storage is backed, how identity federates — which is exactly why the [EKS series](/blog/eks-cluster-provisioning-architecture) on this blog covers that AWS-specific layer separately rather than mixing it in here.

Learn this layer once; the cloud-specific parts are then a mapping exercise rather than relearning Kubernetes.
