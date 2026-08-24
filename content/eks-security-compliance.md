---
title: "Security and Compliance on EKS: Pod Security, Image Scanning, and Admission Control"
slug: eks-security-compliance
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, security, pod-security-standards, kyverno, ecr, imdsv2
excerpt: Pod Security Standards and SecurityContext at the pod level, image scanning with ECR/Trivy, runtime security with Falco, admission control (Kyverno vs Gatekeeper), and the still-easy-to-miss IMDSv2 setting.
status: published
---

Everything else in this series controls what a workload *can reach* (networking, IAM) or *how* it runs (scheduling, scaling). This post is about constraining what a workload is *allowed to do* in the first place, and catching problems before they're ever scheduled.

## Pod Security Standards and admission

Kubernetes' built-in **Pod Security Standards** define three levels — `privileged` (unrestricted), `baseline` (blocks known privilege escalations), `restricted` (heavily locked down: no privilege escalation, must run as non-root, seccomp required) — enforced via the **Pod Security Admission** controller, which is built into the API server and configured per-namespace with a label:

```bash
kubectl label namespace sidhu-ns pod-security.kubernetes.io/enforce=restricted
```

This is the free, zero-extra-infrastructure starting point — no operator to install, just labels. It's coarser than a full policy engine (below), but for "stop anyone from ever running a privileged container in this namespace," it's often all a namespace actually needs.

## SecurityContext and capabilities

At the individual pod/container level, `securityContext` is where the actual restrictions get set — this is what Pod Security Standards *check for*, not a separate mechanism:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
```

Dropping all Linux capabilities and adding back only the specific ones a container genuinely needs (rare — most application containers need none) is the same least-privilege instinct as IAM policy scoping from the [Identity & Access post](/blog/eks-identity-access-irsa-pod-identity-rbac), applied at the kernel-capability level instead of the AWS-API level.

## Image scanning: ECR and Trivy

Catching a vulnerable base image *before* it's running is cheaper than catching it after. **ECR** (Elastic Container Registry) has built-in scanning — basic (on push, CVE-only) or enhanced (continuous rescanning as new CVEs are published, powered by Amazon Inspector). **Trivy** is the standard open-source alternative/complement — runs in CI to fail a build before it ever reaches the registry, or as a standalone scanner against images already in ECR, and covers more than CVEs (misconfigurations, exposed secrets baked into layers, license issues).

The two aren't mutually exclusive: Trivy in CI as a fast pre-merge gate, ECR enhanced scanning as continuous coverage for images already deployed (catching newly-disclosed CVEs in images that were clean when they were pushed).

## Falco: runtime security

Everything above happens before or at deployment time. **Falco** is different — it watches running containers at the kernel level (via eBPF) and alerts on suspicious *runtime* behavior: a shell spawned inside a container that shouldn't have one, an unexpected outbound connection, a write to a sensitive path. It's the layer that catches something a scan couldn't have predicted — a legitimate image that gets exploited after deployment. Not every cluster needs this; it earns its keep on clusters running anything internet-facing or handling sensitive data, less so on an internal batch-processing cluster with no external attack surface.

## Network policies (again) and encryption

The [Networking post](/blog/eks-networking-vpc-cni-deep-dive) already covered NetworkPolicy enforcement via Calico/Cilium — worth repeating here specifically as a security control, not just a networking one: default-deny plus explicit allow rules is the same least-privilege posture as IAM and RBAC, applied to pod-to-pod traffic. Pair it with **encryption in transit** (mTLS, either via a service mesh or application-level TLS) and the **KMS envelope encryption at rest** covered in the [Secrets & Configuration post](/blog/eks-secrets-configuration-configmaps-encryption) for the full data-protection story: encrypted at rest, encrypted in transit, and access restricted by both network policy and IAM.

## IMDSv2: the setting that's still easy to miss

The EC2 Instance Metadata Service is how a node fetches its own AWS credentials — and **IMDSv1** (the older, unauthenticated HTTP-request version) has a well-known SSRF-to-credential-theft path: a vulnerable app on the node can be tricked into requesting `http://169.254.169.254/...` and exfiltrating the node's IAM role credentials. **IMDSv2** requires a session token fetched via a `PUT` request first, which closes that specific SSRF path. Enforce it at the node/launch-template level:

```hcl
metadata_options {
  http_tokens   = "required"  # IMDSv2 only, IMDSv1 disabled
  http_put_response_hop_limit = 1
}
```

This is a launch-template setting, not a Kubernetes setting, which is exactly why it's easy to miss — it doesn't show up when reviewing manifests, only when reviewing the node group's own Terraform/launch template.

## Admission control: Kyverno vs. Gatekeeper

For policy needs beyond what Pod Security Standards covers — require specific labels, block images from untrusted registries, enforce resource limits are always set — an admission control engine intercepts and validates (or mutates) objects before they're persisted. Two dominant options, and the practical difference in 2026 comes down to policy language and operational weight:

- **Kyverno** — policies are plain Kubernetes-style YAML, no new language to learn. Built Kubernetes-first, lighter operational footprint (typically a single controller), and its `PolicyReport` output is the format the Kubernetes Policy Working Group standardized on.
- **OPA Gatekeeper** — policies are written in **Rego**, a purpose-built policy language with real expressive power, and the same Rego policies can be reused outside Kubernetes (API gateways, CI pipelines) if that consistency matters to your org.

For a team standardizing on Kubernetes-only admission policy with no need to reuse the same rules elsewhere, Kyverno is generally the easier default in 2026 — YAML-native policies mean faster onboarding and less specialized knowledge required to maintain them. Reach for Gatekeeper specifically when Rego's expressiveness or cross-platform reuse is a real requirement, not a hypothetical one.

## Next up

[Database & External Integrations](/blog/eks-database-integrations-rds) — connecting workloads on this cluster to RDS, ElastiCache, and everything outside the cluster boundary.
