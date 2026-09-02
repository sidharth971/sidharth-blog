---
title: "Configuration in Kubernetes: ConfigMaps, Secrets, env/envFrom, and the Downward API"
slug: k8s-configuration
category: Kubernetes
tags: kubernetes, k8s, configmaps, secrets, downward-api
excerpt: Getting configuration into a container without baking it into the image — ConfigMaps and Secrets, the real difference between them, why env vars don't hot-reload but mounted files do, and what the Downward API exposes.
status: published
---

*Post 5 of an 18-part Kubernetes concepts series.* ← [Networking](/blog/k8s-networking) · → [Storage](/blog/k8s-storage)

The goal is one image that runs in dev, staging, and production, differing only by what's injected at runtime. These are the mechanisms for that injection — plus one distinction (env vars vs. mounted files) that decides whether config changes can ever take effect without a restart.

## ConfigMap

A ConfigMap is key-value data, stored in etcd, for **non-sensitive** configuration.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  LOG_LEVEL: "info"
  FEATURE_FLAGS: "new-checkout,dark-mode"
  application.yaml: |
    server:
      port: 8080
    cache:
      ttl: 300
```

Values can be simple strings or entire file contents (the `application.yaml` block above), which is what makes mounting a ConfigMap as a config file work.

Limits worth knowing: an object caps at **1 MiB** (it lives in etcd), and a ConfigMap is namespace-scoped — a Pod can only reference one in its own namespace.

## Secret

Structurally almost identical to a ConfigMap, semantically different: intended for sensitive data, base64-encoded in the manifest, and treated differently by the platform.

The point people consistently get wrong: **base64 is encoding, not encryption.** Anyone who can read the Secret can trivially decode it. What actually makes a Secret more protected than a ConfigMap:

- **Encryption at rest** — only if the cluster is configured with an `EncryptionConfiguration` (typically envelope encryption backed by a KMS). Without it, Secrets sit in etcd in plaintext.
- **RBAC** — read access to Secrets is conventionally restricted much more tightly than ConfigMaps ([Security & RBAC](/blog/k8s-security-rbac)).
- **Handling** — the kubelet stores mounted Secrets in tmpfs (memory), not on disk, and they're not written to node storage.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
type: Opaque
stringData:            # stringData takes plaintext; Kubernetes encodes it
  username: appuser
  password: s3cr3t
```

`stringData` is the friendlier field — you write plaintext and Kubernetes handles the base64, rather than encoding by hand and pasting the result.

There are also **typed** Secrets the platform understands: `kubernetes.io/dockerconfigjson` for registry pull credentials, `kubernetes.io/tls` for TLS cert/key pairs consumed by Ingress, `kubernetes.io/service-account-token` for SA tokens.

## Consuming config: env, envFrom, and volumes

Three ways to get either object into a container, and the choice has real consequences.

**Individual env vars** — pick specific keys:

```yaml
env:
  - name: LOG_LEVEL
    valueFrom:
      configMapKeyRef:
        name: app-config
        key: LOG_LEVEL
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: db-credentials
        key: password
```

**`envFrom`** — import every key as an env var:

```yaml
envFrom:
  - configMapRef:
      name: app-config
  - secretRef:
      name: db-credentials
```

Convenient, but it imports *everything* — including keys added later that the app doesn't expect, and it makes it much harder to see what a container actually consumes. Fine for small, purpose-built ConfigMaps; risky as a blanket habit.

**Volume mount** — surface each key as a file:

```yaml
volumeMounts:
  - name: config
    mountPath: /etc/app
    readOnly: true
volumes:
  - name: config
    configMap:
      name: app-config
```

Each key becomes a file (`/etc/app/LOG_LEVEL`, `/etc/app/application.yaml`).

### The difference that matters

**Environment variables are resolved once, at container start.** Update the ConfigMap and the running process keeps the old value forever — nothing updates it, no error, no signal.

**Mounted volumes update automatically** (within a sync period, typically ~1 minute). The file content changes underneath a running Pod. Whether that *helps* depends on the app: it has to re-read the file, or watch it, to notice.

So: mount config as files if you want live updates and the app can re-read them; use env vars for values that only change on deploy anyway. If you need env vars *and* automatic rollout on change, the common fix is a controller like [Reloader](https://github.com/stakater/Reloader) that watches ConfigMaps/Secrets and triggers a rolling restart — the same pattern described in the [EKS Secrets and Configuration post](/blog/eks-secrets-configuration-configmaps-encryption).

One more caveat: a `subPath` mount does **not** receive updates. Mounting a single file via `subPath` to avoid shadowing a directory silently gives up live reloading.

## Downward API

Sometimes an app needs to know about **itself** — its Pod name, namespace, node, IP, labels, or its own resource limits. The Downward API exposes that Pod metadata without calling the API server.

As env vars:

```yaml
env:
  - name: POD_NAME
    valueFrom:
      fieldRef:
        fieldPath: metadata.name
  - name: POD_NAMESPACE
    valueFrom:
      fieldRef:
        fieldPath: metadata.namespace
  - name: NODE_NAME
    valueFrom:
      fieldRef:
        fieldPath: spec.nodeName
  - name: MEMORY_LIMIT
    valueFrom:
      resourceFieldRef:
        containerName: app
        resource: limits.memory
```

Or as files via a `downwardAPI` volume — which is the only way to expose labels and annotations, and unlike env vars, those *do* update when the labels change.

Two genuinely useful applications: tagging logs and metrics with the emitting Pod/node (essential for correlating anything in a multi-replica service), and letting a runtime size itself from its actual limit — a JVM reading `limits.memory` to set its heap instead of guessing from the node's total memory and getting OOMKilled.

## On EKS and AKS

ConfigMaps, Secrets, and the Downward API are identical on both. The divergence is in **where secrets really live** — neither cloud expects you to treat Kubernetes Secrets as your system of record:

- **EKS** — AWS Secrets Manager or Parameter Store via the Secrets Store CSI driver (ASCP), with the rotation/auto-sync behavior and the env-vars-need-a-restart caveat covered in detail in [Accessing AWS Secrets Manager from EKS](/blog/accessing-aws-secrets-manager-from-eks-with-pod-identity-with-auto-sync). Encryption at rest uses KMS envelope encryption.
- **AKS** — Azure Key Vault via the same upstream Secrets Store CSI driver with the Azure provider, authenticating with Microsoft Entra Workload ID. Encryption at rest uses a customer-managed key in Key Vault.

Same CSI driver, same Kubernetes-side objects, different provider plugin and identity mechanism — a good illustration of why learning the upstream layer transfers cleanly between clouds.

---

*Next:* [Kubernetes Storage: Volumes, PV/PVC, StorageClasses, and CSI](/blog/k8s-storage)
