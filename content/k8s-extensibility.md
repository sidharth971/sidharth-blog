---
title: "Extending Kubernetes: CRDs, Operators, Admission Webhooks, and Finalizers"
slug: k8s-extensibility
category: Kubernetes
tags: kubernetes, k8s, crd, operators, admission-webhooks, finalizers
excerpt: How Kubernetes gets extended without forking it — custom resources, the operator pattern, mutating vs validating admission, why CEL-based admission policies are displacing webhooks for validation, and the finalizer that leaves resources stuck Terminating.
status: published
---

*Post 17 of an 18-part Kubernetes concepts series.* ← [Service Mesh](/blog/k8s-service-mesh) · → [Labels, Annotations, and kubeconfig](/blog/k8s-labels-metadata-kubeconfig)

Almost everything interesting in the Kubernetes ecosystem — cert-manager, Prometheus Operator, ArgoCD, Karpenter, Istio, the CSI and CNI drivers — is built on the mechanisms in this post. None of them required changing Kubernetes itself, which is the entire design goal.

## Custom Resource Definitions

A **CRD** registers a new resource type with the API server. After applying it, `kubectl get <yourthing>` works, RBAC applies to it, and it's stored in etcd — it behaves like a built-in type.

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: backups.ops.example.com
spec:
  group: ops.example.com
  scope: Namespaced
  names:
    plural: backups
    singular: backup
    kind: Backup
    shortNames: ["bk"]
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              required: ["schedule", "target"]
              properties:
                schedule: { type: string }
                target: { type: string }
                retentionDays: { type: integer, minimum: 1, default: 7 }
      subresources:
        status: {}
      additionalPrinterColumns:
        - name: Schedule
          type: string
          jsonPath: .spec.schedule
```

Details worth setting deliberately:

- **`schema`** — an OpenAPI v3 schema. The API server validates against it, so bad specs are rejected at `kubectl apply` rather than confusing your controller later. Skipping validation is how you end up debugging typos at runtime.
- **`subresources.status: {}`** — enables a separate status subresource, so a controller updating status doesn't conflict with a user editing spec. Standard practice.
- **`additionalPrinterColumns`** — what shows in `kubectl get`. Small quality-of-life detail that makes a custom resource feel native.
- **Versioning** — exactly one version has `storage: true`; multiple can be `served`. Moving between versions with incompatible schemas needs a conversion webhook.

A **Custom Resource (CR)** is then just an instance:

```yaml
apiVersion: ops.example.com/v1
kind: Backup
metadata:
  name: nightly-db
spec:
  schedule: "0 2 * * *"
  target: postgres-primary
  retentionDays: 30
```

The crucial point: **a CRD on its own does nothing.** You've created a typed object store — Kubernetes will happily persist `Backup` objects and never take a single backup. Something has to act on them.

## The Operator pattern

That something is an **operator**: a controller running in the cluster that watches your custom resources and reconciles reality toward their spec. It's exactly the same reconciliation loop the built-in controllers use ([Cluster Architecture](/blog/k8s-cluster-architecture)):

> watch CRs → compare desired spec to observed state → act → update `.status` → repeat

The value proposition is encoding **operational knowledge as software**. A database operator doesn't just create Pods — it knows how to bootstrap a cluster, promote a replica on primary failure, run a backup before a version upgrade, and resize storage safely. That's the "operator" name: the runbook a human operator would follow, written as a controller.

In practice you build these with **Kubebuilder** or the **Operator SDK**, both wrapping controller-runtime. Points that matter more than the scaffolding:

- **Reconcile must be idempotent.** It will be called repeatedly for the same object — on watch events, on resync, on restart. Every invocation must converge to the same result.
- **Never assume you saw every event.** Controllers resync periodically precisely because events can be missed; reconcile from observed state, not from a delta.
- **Report through `.status`** with conditions, so `kubectl describe` explains what the controller thinks is happening.

## Admission controllers and webhooks

Admission runs **after** authentication/authorization and **before** persistence ([Cluster Architecture](/blog/k8s-cluster-architecture)). Two phases, in order:

1. **Mutating admission** — can *modify* the object (inject a sidecar, add default labels, set a default storage class).
2. **Validating admission** — can only *accept or reject* (enforce required labels, block `:latest` images, forbid privileged Pods).

Mutating always runs first, so validation sees the final object — which is why a mutating webhook that injects something non-compliant gets caught by validation rather than sneaking through.

A **webhook** is your own HTTPS service the API server calls:

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
metadata:
  name: require-team-label
webhooks:
  - name: require-team-label.example.com
    rules:
      - apiGroups: ["apps"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["deployments"]
    clientConfig:
      service:
        name: policy-webhook
        namespace: policy
        path: /validate
      caBundle: <base64-CA>
    admissionReviewVersions: ["v1"]
    sideEffects: None
    failurePolicy: Fail
    timeoutSeconds: 5
```

**`failurePolicy` is the field that can take down your cluster.** With `Fail`, if your webhook service is unreachable, every matching request is **rejected** — so a webhook covering all Pods, whose backing Deployment is down, means no Pods can be created anywhere, including the webhook's own replacement. That's a genuine, well-documented way to deadlock a cluster.

Mitigations: exclude `kube-system` and your webhook's own namespace via `namespaceSelector`, keep `timeoutSeconds` short, run the webhook highly available, and consider `failurePolicy: Ignore` for non-critical policies.

## CEL admission policies — no webhook required

For validation specifically, there's now an in-tree alternative that avoids running a webhook server at all: **ValidatingAdmissionPolicy**, which expresses rules in **CEL** and is evaluated by the API server directly. It's been **GA since Kubernetes 1.30** and enabled by default.

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: require-resource-limits
spec:
  matchConstraints:
    resourceRules:
      - apiGroups: ["apps"]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["deployments"]
  validations:
    - expression: "object.spec.template.spec.containers.all(c, has(c.resources.limits))"
      message: "every container must set resource limits"
```

A companion `ValidatingAdmissionPolicyBinding` scopes it to namespaces. The advantages are real: no webhook service to deploy, secure, certificate-rotate, or keep highly available — and no `failurePolicy: Fail` outage mode, since there's nothing external to be unreachable.

A **MutatingAdmissionPolicy** equivalent exists but is much newer and less mature than its validating counterpart, so mutation still generally means a webhook today.

The practical guidance: for straightforward validation rules, reach for ValidatingAdmissionPolicy before writing a webhook. For complex logic, mutation, or when you want a full policy framework with reporting, use **Kyverno** or **OPA Gatekeeper** (both of which are themselves admission webhooks — see [Security and Compliance on EKS](/blog/eks-security-compliance)).

## Finalizers

A **finalizer** is a string in `metadata.finalizers` that blocks deletion until it's removed. When you delete an object with finalizers, the API server doesn't delete it — it sets `deletionTimestamp` and leaves the object in place. The controller sees that timestamp, performs cleanup (deleting a cloud load balancer, taking a final backup, deregistering from an external system), then removes its finalizer. Only when the list is empty does the object actually disappear.

```yaml
metadata:
  finalizers:
    - ops.example.com/cleanup-backups
```

This is how Kubernetes avoids orphaning external resources — it's why deleting a `LoadBalancer` Service actually removes the cloud load balancer, and why deleting a PVC with the `kubernetes.io/pvc-protection` finalizer waits until no Pod is using it.

It's also the answer to the very common **"my namespace is stuck in `Terminating` forever."** Something has a finalizer whose controller is gone (uninstalled operator, dead webhook), so nothing ever removes it:

```bash
kubectl get namespace stuck-ns -o jsonpath='{.spec.finalizers}'
kubectl get <resource> <name> -o jsonpath='{.metadata.finalizers}'
```

Force-removing a finalizer by editing the object works, but it's genuinely a last resort — you're skipping the cleanup it existed to perform, which usually means leaked cloud resources still costing money. Fix the controller first if you can.

## Custom schedulers

The default scheduler can be replaced or supplemented. A Pod names one:

```yaml
spec:
  schedulerName: my-custom-scheduler
```

Pods with an unknown `schedulerName` sit `Pending` forever — nothing else will claim them, which makes this easy to misconfigure. Before writing a scheduler, note that **Scheduler Framework plugins** are usually the better path: extension points in the existing scheduler (filter, score, bind) rather than a whole parallel implementation with its own race conditions against the default scheduler.

## Other extension points, briefly

Also pluggable, all covered elsewhere in this series: **CRI** (container runtimes), **CNI** (networking), **CSI** ([storage](/blog/k8s-storage)), **device plugins** (GPUs and other hardware), and **API aggregation** (registering an extension API server — how the Metrics API behind `kubectl top` is served).

## On EKS and AKS

CRDs, operators, webhooks, and finalizers are pure upstream and behave identically. Two cloud-relevant notes:

- **You cannot add flags to a managed API server**, so extension has to go through these supported mechanisms — which is precisely why they exist and why the ecosystem standardized on them.
- **Managed add-ons are operators.** EKS add-ons and AKS add-ons/extensions install controllers that reconcile CRDs on your behalf, with the cloud handling version compatibility and patching ([CI/CD and Add-ons on EKS](/blog/eks-cicd-addons)). Karpenter is a good example: a CRD-plus-controller you could install yourself, offered as managed infrastructure on both clouds.

A practical warning for cluster upgrades on both: **CRDs installed by third-party charts are not managed by the cloud**, and a Kubernetes version bump can outpace an operator that hasn't been updated. Checking operator compatibility before a control-plane upgrade is part of the upgrade checklist ([Cluster Architecture](/blog/k8s-cluster-architecture)).

---

*Next:* [Labels, Annotations, Owner References, Field Selectors, and kubeconfig](/blog/k8s-labels-metadata-kubeconfig)
