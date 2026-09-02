---
title: "Kubernetes Security and RBAC: ServiceAccounts, Roles, SecurityContext, and Pod Security"
slug: k8s-security-rbac
category: Kubernetes
tags: kubernetes, k8s, rbac, security, serviceaccount, pod-security
excerpt: The four RBAC objects and how they combine, why ServiceAccounts are two identities at once, SecurityContext and Linux capabilities, Pod Security Admission (what replaced PodSecurityPolicy), and encrypting Secrets at rest.
status: published
---

*Post 8 of an 18-part Kubernetes concepts series.* ← [Resource Management](/blog/k8s-resource-management) · → [Autoscaling](/blog/k8s-autoscaling)

Two distinct questions get conflated constantly, so it's worth separating them up front:

1. **What can this identity do to the Kubernetes API?** → RBAC.
2. **What can this container do on the node it's running on?** → SecurityContext and Pod Security Admission.

Different mechanisms, different failure modes. A perfect RBAC setup doesn't stop a privileged container from escaping to the host.

## ServiceAccount

Every Pod runs as a ServiceAccount — the `default` one in its namespace if you don't specify. It's the Pod's identity **to the Kubernetes API**, and by default its token is mounted into the container.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: app-sa
  namespace: prod
---
# in the Pod spec
spec:
  serviceAccountName: app-sa
  automountServiceAccountToken: false     # if the app never calls the API
```

Two habits worth adopting: create a dedicated ServiceAccount per workload rather than sharing `default` (so permissions can be scoped per app), and set `automountServiceAccountToken: false` for workloads that never talk to the Kubernetes API — which is most application code. A mounted token an application doesn't need is just credential material sitting on disk waiting to be exfiltrated.

Worth knowing: a ServiceAccount ends up being **two identities at once** — an RBAC subject inside the cluster, and (via workload identity federation) the anchor for cloud IAM permissions outside it. Same object, two unrelated permission systems, which is a genuine source of confusion when debugging "why can't my Pod do X."

## Role and ClusterRole

A **Role** grants permissions **within one namespace**. A **ClusterRole** grants them **cluster-wide**, and is also the only way to grant access to cluster-scoped resources (nodes, PersistentVolumes, namespaces themselves).

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: prod
rules:
  - apiGroups: [""]                    # "" is the core API group
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "update", "patch"]
```

RBAC is **purely additive** — there are no deny rules. If no rule grants a verb, it's denied; you can't grant broadly and then carve out exceptions. That constraint is why least-privilege has to be designed in from the start rather than retrofitted by subtraction.

Also note subresources are separate: `pods/log` and `pods/exec` are distinct from `pods`. Granting `get` on `pods` doesn't grant log access — and granting `pods/exec` is effectively shell access into containers, which deserves scrutiny.

## RoleBinding and ClusterRoleBinding

Bindings attach a role to subjects (users, groups, ServiceAccounts).

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: app-can-read-pods
  namespace: prod
subjects:
  - kind: ServiceAccount
    name: app-sa
    namespace: prod
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

The combination that catches people: a **RoleBinding can reference a ClusterRole**, which grants that ClusterRole's permissions *only within the binding's namespace*. That's the idiomatic way to reuse one well-defined ClusterRole (say, `view`) across many namespaces without redefining it each time.

A **ClusterRoleBinding**, by contrast, grants cluster-wide — no namespace scoping. That's the one to review carefully; a ClusterRoleBinding to `cluster-admin` is total control of the cluster.

Kubernetes ships default ClusterRoles worth knowing: `view` (read-only, no Secrets), `edit` (read/write most things), `admin` (edit plus RBAC within a namespace), and `cluster-admin` (everything).

```bash
kubectl auth can-i list secrets --as=system:serviceaccount:prod:app-sa -n prod
```

That command is the fastest way to answer RBAC questions definitively instead of reasoning about it.

## SecurityContext and capabilities

Where RBAC governs API access, **SecurityContext** governs what the container process can do on the node. Settable at Pod level (applies to all containers) or per container.

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  fsGroup: 10001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
    add: ["NET_BIND_SERVICE"]     # only if you truly need port <1024
  seccompProfile:
    type: RuntimeDefault
```

Each of these closes a specific hole:
- `runAsNonRoot` / `runAsUser` — container root is still uid 0 on the node; a container escape as root is far worse than as uid 10001.
- `allowPrivilegeEscalation: false` — blocks `setuid` binaries from gaining more privileges than the parent.
- `readOnlyRootFilesystem: true` — an attacker can't write a payload to disk. Pair with an `emptyDir` for paths that genuinely need writes.
- `capabilities.drop: ["ALL"]` — Linux capabilities are the granular pieces of root. Most applications need **none** of them; drop everything and add back only what's proven necessary.
- `seccompProfile: RuntimeDefault` — restricts available syscalls to the runtime's vetted set.

And the one to never set: `privileged: true` disables essentially all container isolation. It's effectively root on the node.

## Pod Security Standards and Admission

**PodSecurityPolicy is gone** — deprecated in 1.21, removed in 1.25. Anything still referencing PSP is out of date.

Its replacement is **Pod Security Admission**, a built-in admission controller enforcing three standard profiles, configured per namespace with labels:

- **privileged** — unrestricted.
- **baseline** — blocks known privilege escalations (no `privileged`, no host namespaces, no hostPath).
- **restricted** — hardened: non-root required, capabilities dropped, seccomp required, read-only root recommended.

```bash
kubectl label namespace prod \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted
```

Three modes matter: `enforce` rejects violating Pods, `warn` returns a warning to the user but allows it, `audit` records it in the audit log. The sane rollout is `warn` + `audit` first to discover what would break, then flip to `enforce`.

PSA is deliberately simple — three fixed profiles, no custom rules. Anything more specific (required labels, allowed registries, custom constraints) needs a policy engine like Kyverno or OPA Gatekeeper, covered from the AWS angle in [Security and Compliance on EKS](/blog/eks-security-compliance).

## Network policies as a security control

Covered mechanically in [Networking](/blog/k8s-networking), but it belongs in the security picture too: default Kubernetes networking is **flat and fully permissive** — a compromised Pod in one namespace can reach every other Pod in the cluster. Default-deny NetworkPolicies per namespace, with explicit allows, is the same least-privilege instinct as RBAC applied to traffic instead of API calls.

## Secrets encryption at rest

By default, Secrets are stored in etcd **unencrypted** — base64-encoded, which is not encryption ([Configuration](/blog/k8s-configuration)). Anyone with etcd access, or an etcd backup, reads them in the clear.

The fix is an `EncryptionConfiguration` on the API server, ideally using a KMS provider for envelope encryption rather than a static local key:

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources: ["secrets"]
    providers:
      - kms:
          apiVersion: v2
          name: cloud-kms
          endpoint: unix:///var/run/kmsplugin/socket.sock
      - identity: {}     # fallback for reading existing plaintext data
```

Two operational notes: it only applies **going forward**, so existing Secrets stay plaintext until rewritten (a no-op update forces re-encryption), and encryption at rest does **not** stop anyone with `get secrets` RBAC from reading the decrypted value. Both controls are needed — they defend against different attackers.

## On EKS and AKS

RBAC, SecurityContext, and Pod Security Admission are identical upstream on both. The divergence is at the **edges** — how humans authenticate to the cluster, and how Pods authenticate to cloud services:

| | EKS | AKS |
|---|---|---|
| Cluster access | EKS access entries (replacing the `aws-auth` ConfigMap), mapped to RBAC | Entra ID integration + Azure RBAC for Kubernetes, or native K8s RBAC |
| Workload → cloud identity | IRSA (OIDC) or EKS Pod Identity | Microsoft Entra Workload ID (OIDC federation) |
| Secrets at rest | KMS envelope encryption | Customer-managed key in Key Vault |

The workload-identity comparison is the interesting one: **Entra Workload ID is architecturally close to EKS IRSA** — both federate an OIDC token from the cluster's issuer to the cloud IdP, both bind to a ServiceAccount. EKS Pod Identity is AWS's newer, non-OIDC approach (an agent serving credentials locally, associations managed through the EKS API) with no direct AKS equivalent. Detail on the AWS side is in [EKS Identity & Access](/blog/eks-identity-access-irsa-pod-identity-rbac).

Notably, on **both** clouds the ServiceAccount is the binding point — which is exactly why the "one identity, two permission systems" point earlier matters in practice.

---

*Next:* [Autoscaling: HPA, VPA, Cluster Autoscaler, and metrics-server](/blog/k8s-autoscaling)
