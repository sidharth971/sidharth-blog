---
title: "Secrets and Configuration on EKS: ConfigMaps, KMS-Encrypted Secrets, and Rotation"
slug: eks-secrets-configuration-configmaps-encryption
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, secrets, configmaps, kms, encryption
excerpt: The rest of the secrets/config picture beyond Secrets Manager — ConfigMaps vs Secrets, envelope encryption of etcd with KMS, and what "rotation" actually means depending on how a pod consumes a secret.
status: published
---

The [Secrets Manager + Pod Identity post](/blog/accessing-aws-secrets-manager-from-eks-with-pod-identity-with-auto-sync) in this series covers pulling secrets from AWS into pods via the CSI driver. This one covers what's underneath and around that: the native Kubernetes primitives (ConfigMap, Secret), how EKS actually protects Secret data at rest, and what "rotation" means once you widen the lens past just Secrets Manager.

## ConfigMap vs. Secret — same shape, different contract

Both are key-value objects you can mount as files or inject as environment variables. The only functional difference between them is intent and handling:

- **ConfigMap** — plain text, meant for non-sensitive configuration (feature flags, URLs, log levels). Stored in etcd unencrypted by default, same as any other API object.
- **Secret** — base64-encoded (not encrypted — base64 is trivially reversible, it's an encoding, not protection), meant for sensitive data (passwords, tokens, keys). What actually makes a Secret more protected than a ConfigMap on EKS is envelope encryption at rest (below) and tighter default RBAC conventions — not anything inherent to the object type itself.

The practical rule: if base64-decoding the value in `kubectl get secret -o yaml` would be a problem if someone saw it, it belongs in a Secret. Everything else is a ConfigMap.

## Encryption at rest: envelope encryption with KMS

By default, everything in etcd — ConfigMaps and Secrets alike — is stored as plaintext on the control plane's disks (AWS manages that disk, but "AWS manages it" isn't the same as "it's encrypted"). EKS supports **envelope encryption** for Secrets specifically: enable it at cluster creation (or add it after the fact) by pointing at a KMS key, and every Secret object gets encrypted with a data encryption key that is itself encrypted by your KMS key before being written to etcd.

```bash
aws eks associate-encryption-config \
  --cluster-name sidhu-cluster \
  --encryption-config '[{"resources":["secrets"],"provider":{"keyArn":"arn:aws:kms:us-east-1:111122223333:key/xxxx"}}]'
```

Notes worth knowing before flipping this on:
- It only applies going forward — existing Secrets aren't retroactively encrypted until they're next written (a no-op `kubectl annotate` touch on each Secret forces re-encryption if you need it applied immediately after enabling).
- It protects the etcd-at-rest copy specifically. It does **not** stop someone with `get secrets` RBAC permission from reading the decrypted value via the API — encryption at rest and API-level authorization are separate controls, and you need both.
- The KMS key's own policy matters as much as enabling the feature — if the key policy is too permissive, envelope encryption adds a step without adding real protection.

## Rotation means different things depending on the path

"Secret rotation" isn't one mechanism — it depends entirely on how the value gets from its source of truth into a running process:

- **Secrets Manager → CSI driver → mounted file**: covered in depth in the [Secrets Manager post](/blog/accessing-aws-secrets-manager-from-eks-with-pod-identity-with-auto-sync) — the rotation reconciler polls and updates the file live, no restart needed.
- **Secrets Manager → CSI driver → synced K8s Secret → env var**: the Secret object updates on the same poll, but the *running process* only sees it after a restart — this is the gotcha flagged in that post.
- **Hand-managed K8s Secret** (created directly via `kubectl create secret` or applied from a manifest, no Secrets Manager involved): there's no automatic rotation at all. Rotating means updating the Secret object yourself (CI/CD pipeline, a script, a human) and restarting whatever consumes it — which is exactly the gap tools like Secrets Manager + the CSI driver, or the External Secrets Operator, exist to close.

If you're hand-rolling Secret updates and want consuming pods to pick up changes automatically without wiring a full CSI/ESO pipeline, [Reloader](https://github.com/stakater/Reloader) (referenced in the Secrets Manager post) watches Secret/ConfigMap changes and triggers a rolling restart of anything annotated to care — a lighter-weight partial answer than a full external-secrets pipeline, worth knowing about even outside the Secrets Manager path.

## Practical guidance

- Default to Secrets Manager + the CSI driver (or External Secrets Operator, mentioned as an alternative in the [Identity & Access post](/blog/eks-identity-access-irsa-pod-identity-rbac)) for anything that needs real rotation — hand-managed Secrets are fine for genuinely static values, not for anything that changes.
- Turn on KMS envelope encryption for Secrets on every cluster that holds anything real — it's a one-time setup cost with no ongoing operational burden.
- Never put a Secret's contents in a ConfigMap "just for now" — the RBAC and encryption story diverges immediately, and "just for now" configuration has a way of outliving its justification.

## Next up

[Storage](/blog/eks-storage-ebs-efs-csi-drivers) — what happens once a pod needs to actually persist something to disk.
