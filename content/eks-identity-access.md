---
title: "EKS Identity & Access: IRSA vs Pod Identity, OIDC, RBAC, and Access Entries"
slug: eks-identity-access-irsa-pod-identity-rbac
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, iam, pod-identity, irsa, rbac, access-entries, oidc
excerpt: The full identity picture on EKS — IRSA vs Pod Identity for workloads, OIDC under the hood, the shift from aws-auth to access entries for cluster access, RBAC, and cross-account roles.
status: published
---

Two of the earlier posts in this series ([ALB controller](/blog/path-based-routing-on-eks-with-the-aws-load-balancer-controller-pod-identity), [Secrets Manager](/blog/accessing-aws-secrets-manager-from-eks-with-pod-identity-with-auto-sync)) walked through Pod Identity hands-on. This post is the map around it: how Pod Identity relates to IRSA, how *cluster* access (who can `kubectl`) differs from *workload* access (what a pod's AWS calls are allowed to do), and where RBAC fits into both.

There are genuinely two separate identity questions on EKS, and mixing them up is the single most common source of confusion:

1. **Who can access the Kubernetes API** (i.e., run `kubectl` against the cluster) — access entries / `aws-auth`, then RBAC.
2. **What AWS API calls can a pod make** — IRSA or Pod Identity.

They share IAM as the underlying primitive, but they're configured completely differently and solve different problems.

## Workload identity: IRSA vs. Pod Identity

Both let a pod assume an IAM role without static credentials baked into the container. The difference is entirely in the plumbing:

**IRSA (IAM Roles for Service Accounts)** — the original mechanism. Requires an **OIDC identity provider** registered for your cluster in IAM; the service account is annotated with the role ARN (`eks.amazonaws.com/role-arn`); a mutating webhook injects a projected service-account token into the pod; the AWS SDK exchanges that token for temporary credentials via `sts:AssumeRoleWithWebIdentity`. The trust policy's `Principal` is the OIDC provider, scoped with a `Condition` matching the specific namespace/service-account. Works on every EKS version, including older clusters.

**EKS Pod Identity** — the newer mechanism (what every hands-on post in this series has used). No OIDC provider setup, no service-account annotation. Instead: install the **Pod Identity agent** add-on, create an **association** (`aws eks create-pod-identity-association`) directly linking a namespace + service account to a role ARN, and the trust policy's `Principal` is simply `pods.eks.amazonaws.com`. The agent runs as a DaemonSet and serves credentials to pods locally — the SDK's default credential chain picks them up with zero pod-side configuration. Requires EKS 1.24+.

| | IRSA | Pod Identity |
|---|---|---|
| Setup | OIDC provider + SA annotation | Agent add-on + association |
| Trust policy principal | OIDC provider ARN | `pods.eks.amazonaws.com` |
| Cross-cluster role reuse | New trust policy per cluster (different OIDC provider) | Same role, new association — no trust policy edits |
| Session tags for ABAC | No | Yes (`sts:TagSession`) |
| Minimum EKS version | Any | 1.24+ |

For new clusters, Pod Identity is the simpler default — this whole series has used it for exactly that reason. IRSA remains fully supported and is still what you'll find in older infrastructure and a lot of existing Terraform modules; there's no urgency to migrate a working IRSA setup, but new roles on a 1.24+ cluster should default to Pod Identity.

## OIDC provider — still there, just not always yours to manage

If you're on IRSA, the OIDC provider is the trust anchor: EKS exposes an OIDC-compliant issuer URL per cluster, you register it as an IAM identity provider once, and every IRSA trust policy references it. Under Pod Identity, this whole layer disappears from your day-to-day operations — the Pod Identity agent handles the credential exchange internally without you provisioning an OIDC provider at all. Worth knowing it's *why* Pod Identity setup feels shorter, not just that it is.

## Cluster access: aws-auth ConfigMap → access entries

Separately from workload identity — who's allowed to authenticate to the Kubernetes API at all. This used to be exclusively the **`aws-auth` ConfigMap** in `kube-system`: a hand-edited YAML mapping IAM principal ARNs to Kubernetes usernames/groups. It's still present on every cluster for backward compatibility, but it has a real, well-known failure mode: a single formatting mistake can lock out every non-creator principal, with no path back in except deleting and recreating the cluster's access config from scratch.

**Access entries** are the current recommended replacement — access control managed through the EKS API instead of a ConfigMap:

```bash
# Grant an IAM role standard cluster access
aws eks create-access-entry \
  --cluster-name sidhu-cluster \
  --principal-arn arn:aws:iam::111122223333:role/platform-team \
  --type STANDARD

# Attach a predefined access policy (cluster-admin-equivalent, edit, view, etc.)
aws eks associate-access-policy \
  --cluster-name sidhu-cluster \
  --principal-arn arn:aws:iam::111122223333:role/platform-team \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
  --access-scope type=cluster
```

Why it's better in practice: changes go through the EKS API (atomic, shows up in CloudTrail, recoverable via API call even if you lock yourself out — no more "delete the cluster" as the disaster-recovery plan), and you can scope an access policy to a specific namespace instead of the whole cluster. Existing clusters keep working with `aws-auth` unchanged; access entries are additive, not a forced migration, but new access grants should go through access entries going forward.

## RBAC — still the authorization layer underneath both

Whether identity comes from `aws-auth` groups or an access entry's Kubernetes group mapping, actual permissions on cluster objects are still standard Kubernetes RBAC: `Role`/`ClusterRole` define *what* (verbs on resources), `RoleBinding`/`ClusterRoleBinding` attach that to a subject (a user, group, or service account). Access entries with an **access policy** attached skip this layer entirely (AWS's predefined policies map directly to permissions without you writing RBAC objects) — access entries with a **Kubernetes group** instead require you to have matching `RoleBinding`s that reference that group, same as the `aws-auth` model always did.

`ServiceAccount`s are the RBAC-relevant identity *inside* the cluster for workloads — every pod runs as one (default, if unspecified), and it's the same object that Pod Identity associations and IRSA annotations attach to. Worth remembering: a service account is simultaneously an RBAC subject (what it can do to the K8s API) and, separately, an IAM identity anchor (what AWS APIs it can call) — two unrelated permission systems that happen to hang off the same object.

## Least privilege and cross-account roles

Two practices that matter more as the cluster grows:

- **Scope IAM policies to the resource, not the service** — the Secrets Manager post in this series scoped the policy to one secret ARN, not `secretsmanager:*` on `*`. Do the same everywhere: specific ARNs or tag-based conditions, not wildcards, per role.
- **Cross-account role assumption** — a pod's Pod Identity/IRSA role can itself assume a role in a *different* AWS account via a standard `sts:AssumeRole` chain, useful for centralized logging accounts, shared tooling accounts, or a hub-and-spoke account structure. The pod's own role needs `sts:AssumeRole` permission on the target role, and the target role's trust policy needs to allow the source role's ARN — ordinary cross-account IAM, just initiated from inside a pod instead of an EC2 instance.

## Next up

With workload and cluster access sorted, the next post covers the parts of Secrets & Configuration that aren't already covered by the [Secrets Manager walkthrough](/blog/accessing-aws-secrets-manager-from-eks-with-pod-identity-with-auto-sync) — ConfigMaps, Kubernetes Secrets encryption at rest, and rotation as a general concept.
