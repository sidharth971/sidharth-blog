---
title: "Kubernetes Security Hands-On: RBAC, NetworkPolicy, Kyverno, and External Secrets"
slug: devsecops-kubernetes-security
category: DevSecOps
subcategory: Kubernetes
tags: devsecops, kubernetes, security, rbac, networkpolicy, kyverno, external-secrets, vault
excerpt: A build-it-yourself security lab on a local kind cluster — namespaces, RBAC with verification that actually proves something, default-deny networking with Calico, Pod Security Admission, Kyverno policy as code, and Git-safe secrets via External Secrets Operator and Vault.
status: published
---

This is a lab, not a concepts post. Everything below runs on a local [kind](https://kind.sigs.k8s.io/) cluster in about an hour, and every control gets **verified** — applied, then deliberately tested from the wrong side to confirm it actually blocks what it claims to block.

That verification habit is the whole point. Kubernetes security has an unusually nasty failure mode: most controls fail *open* and fail *silently*. A NetworkPolicy with no CNI to enforce it is accepted by the API server and does nothing. An RBAC test against a ServiceAccount that doesn't exist returns "no" and proves nothing. A Kyverno policy that only checks for `:latest` waves through an untagged image that resolves to latest anyway. In every one of those cases you get a green result and no security.

For the underlying theory — what a Role actually is, how the authorization chain works, what a `securityContext` field does — see [Kubernetes Security & RBAC](/blog/k8s-security-rbac) and [Security and Compliance on EKS](/blog/eks-security-compliance). This post assumes those and focuses on making the controls real.

## 0. Cluster setup — and why the default kind cluster won't work

Prerequisites:

```bash
docker --version
kubectl version --client
kind version
helm version
```

The obvious command is the wrong one here:

```bash
# Don't use this one for this lab
kind create cluster --name k8s-security
```

A default kind cluster ships with **kindnet** as its CNI, and **kindnet does not implement NetworkPolicy — by design**. The API server will happily accept every NetworkPolicy you apply, `kubectl get networkpolicy` will list them, and **none of them will be enforced**. You'd reach section 3, apply a policy, watch the attacker pod still reach the backend, and reasonably conclude you'd written the policy wrong.

You also can't fix this after the fact, because a CNI is chosen at cluster creation. So create the cluster with the default CNI disabled and a pod subnet Calico expects:

```yaml
# kind-security.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: k8s-security
networking:
  disableDefaultCNI: true
  podSubnet: "192.168.0.0/16"
nodes:
  - role: control-plane
  - role: worker
```

```bash
kind create cluster --config kind-security.yaml
```

Nodes will sit `NotReady` until a CNI is installed — that's expected, not a failure:

```bash
kubectl get nodes
# NAME                          STATUS     ROLES           AGE
# k8s-security-control-plane    NotReady   control-plane   20s
```

Install Calico:

```bash
kubectl apply -f https://raw.githubusercontent.com/projectcalico/calico/v3.32.2/manifests/calico.yaml
kubectl -n kube-system rollout status daemonset/calico-node --timeout=180s
kubectl get nodes
# STATUS should now be Ready
```

Use a current Calico release rather than an older pinned one — `v3.27.0` is from December 2023 and predates several Kubernetes versions you might be running. Check the [Calico releases](https://github.com/projectcalico/calico/releases) and pin deliberately, the same reasoning as pinning any other dependency.

## 1. Namespaces

A namespace is a **logical scoping boundary** — it's what RBAC rules, NetworkPolicies, and quotas attach to. Create two, representing two teams:

```bash
kubectl create namespace payments
kubectl create namespace search
kubectl get namespaces
```

```bash
kubectl create deployment nginx-payments --image=nginx:1.29 -n payments
kubectl create deployment nginx-search   --image=nginx:1.29 -n search

kubectl get pods -n payments
kubectl get pods -n search
```

Use an explicit tag rather than bare `nginx` — otherwise the Kyverno policy in section 5 will reject these later, which is a good demonstration but an annoying surprise mid-lab.

The critical point, and the reason this is section 1 rather than a footnote: **a namespace provides no security on its own.** Out of the box, a Pod in `search` can reach a Pod in `payments` over the network, and any credential with cluster-wide read can list Secrets in both. A namespace is not a wall — it's a *label to hang walls on*. Every remaining section builds one of those walls.

It's also worth being honest that even fully built, this is **soft multi-tenancy**: tenants still share a kernel and a control plane. For genuinely untrusted workloads the answer is separate clusters or a sandboxed runtime, not more namespaces ([Labels, Metadata, and Multi-Tenancy](/blog/k8s-labels-metadata-kubeconfig)).

## 2. RBAC — and a verification step that actually proves something

RBAC answers four questions: **who** (user or ServiceAccount), **what** (verbs), **on what** (resources), and **where** (namespace or cluster-wide). Four objects: `Role` and `ClusterRole` define permissions; `RoleBinding` and `ClusterRoleBinding` grant them to subjects.

A read-only Role for Pods in `payments`:

```bash
kubectl apply -f - <<'EOF'
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: payments
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
EOF
```

A ServiceAccount to grant it to, and the binding:

```bash
kubectl create serviceaccount payments-user -n payments
```

```bash
kubectl apply -f - <<'EOF'
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: read-pods-binding
  namespace: payments
subjects:
  - kind: ServiceAccount
    name: payments-user
    namespace: payments
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
EOF
```

Note `<<'EOF'` with quotes throughout this post — it stops the shell expanding `$` inside the manifest, which matters the moment a policy or config contains a variable-looking string.

### Verifying it — the part that's easy to get wrong

```bash
kubectl auth can-i list pods \
  --as=system:serviceaccount:payments:payments-user -n payments
# yes
```

Now the negative test. This is where a subtle mistake makes the whole check meaningless:

```bash
# WRONG — 'dev-user' in namespace 'dev' does not exist
kubectl auth can-i delete pods \
  --as=system:serviceaccount:dev:dev-user -n payments
# no
```

That returns `no`, which *looks* like the policy working. It isn't. RBAC is **deny by default**, so a subject that doesn't exist is denied automatically — you'd get `no` for a completely empty cluster with no Roles at all. The test proves nothing about your Role.

Test the **same identity you granted**, on a verb you deliberately withheld:

```bash
kubectl auth can-i delete pods \
  --as=system:serviceaccount:payments:payments-user -n payments
# no      <- the Role really does exclude 'delete'

kubectl auth can-i list pods \
  --as=system:serviceaccount:payments:payments-user -n search
# no      <- the RoleBinding really is namespace-scoped

kubectl auth can-i list secrets \
  --as=system:serviceaccount:payments:payments-user -n payments
# no      <- the Role really is limited to pods
```

Three assertions, one identity, each isolating a different dimension of the rule. That's a test; the original was a tautology.

`kubectl auth can-i --list --as=...` dumps everything a subject can do, which is the fastest way to audit an identity you inherited.

### RBAC anti-patterns worth knowing now

- **Wildcards.** `verbs: ["*"]` or `resources: ["*"]` grants permissions on resource types that don't exist yet — every CRD installed later is silently included.
- **`cluster-admin` as a shortcut.** Binding it "temporarily" to unblock a deploy is how most over-permissioned clusters got that way.
- **`get secrets` is `read all credentials`.** Anyone who can read Secrets in a namespace holds every credential in it. Treat it as a distinct privilege tier, not just another read verb.
- **`escalate`, `bind`, and `impersonate` are privilege escalation.** `escalate` lets a subject grant itself permissions it doesn't have; `bind` lets it attach existing Roles; `impersonate` is `--as` as a permission. Normally RBAC prevents granting more than you hold — these three verbs are the documented exceptions.
- **Turn off token automounting.** Every Pod gets its ServiceAccount token mounted at `/var/run/secrets/kubernetes.io/serviceaccount` by default, so any RCE in your app comes with an API credential attached. If the app doesn't call the API, remove it:

```yaml
spec:
  automountServiceAccountToken: false
```

Set it on the ServiceAccount to cover everything using it, or per-Pod. Modern tokens are at least short-lived, audience-bound projected tokens rather than the old non-expiring Secret-based ones — but the best token is the one that isn't mounted.

## 3. NetworkPolicy — default deny first

By default **every Pod can reach every other Pod**, across namespaces, with no restriction. NetworkPolicy is the zero-trust fix, and it works as an allow-list: once *any* policy selects a Pod, everything not explicitly allowed for that direction is denied.

Set up a realistic three-Pod scenario in `payments`:

```bash
kubectl run backend --image=nginx:1.29 --labels="app=my-app" -n payments
kubectl run frontend --image=busybox:1.37 --labels="role=frontend" -n payments -- sleep 3600
kubectl run attacker --image=busybox:1.37 -n payments -- sleep 3600

kubectl expose pod backend --port=80 --name=backend-svc -n payments
kubectl wait --for=condition=Ready pod --all -n payments --timeout=90s
```

Confirm the insecure default first — this baseline matters, because if you skip it you can't tell "policy working" from "networking broken":

```bash
kubectl exec -n payments attacker -- wget -qO- --timeout=5 backend-svc
# <!DOCTYPE html> ... Welcome to nginx!
```

Now allow only `role=frontend` to reach `app=my-app` on TCP/80:

```bash
kubectl apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-backend
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app: my-app
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              role: frontend
      ports:
        - protocol: TCP
          port: 80
EOF
```

Verify both directions:

```bash
kubectl exec -n payments frontend -- wget -qO- --timeout=5 backend-svc
# works

kubectl exec -n payments attacker -- wget -qO- --timeout=5 backend-svc
# wget: download timed out      <- blocked
```

A blocked NetworkPolicy **times out**; it doesn't return "connection refused". Always pass `--timeout` in tests or you'll wait a long time wondering whether it worked.

### The default-deny policy the lab above is missing

The policy above protects `app=my-app`. Every other Pod in the namespace is still wide open — `attacker` can reach anything that isn't specifically selected. Real zero-trust starts from the other end: deny everything in the namespace, then allow.

```bash
kubectl apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: payments
spec:
  podSelector: {}          # every Pod in the namespace
  policyTypes:
    - Ingress
    - Egress
EOF
```

An empty `podSelector: {}` with no `ingress`/`egress` rules denies both directions for every Pod. Your earlier allow-rule still applies — **policies are additive**, so the union of all matching policies is what's permitted.

Apply that and something will immediately break, which is the most useful thing this lab teaches: **egress deny blocks DNS.** CoreDNS lives in `kube-system`, so name resolution stops and every hostname lookup fails — usually surfacing as a confusing "bad address" rather than anything mentioning policy. You must allow it back explicitly:

```bash
kubectl apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns-egress
  namespace: payments
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: kube-system
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 53
EOF
```

Three more things that bite people:

- **NetworkPolicy selects Pods, not Services.** You allow traffic to the backend Pod's labels; the Service is just a stable address in front of it ([Networking](/blog/k8s-networking)).
- **`namespaceSelector` needs labels on the namespace.** `kubernetes.io/metadata.name` is auto-applied by the API server, which saves you labelling namespaces by hand.
- **Ingress and egress are independent.** A rule allowing frontend→backend ingress does nothing if a separate egress policy on frontend blocks the outbound leg. Both ends must permit it.

Calico also offers `GlobalNetworkPolicy` for cluster-wide rules and explicit `Deny` actions with ordering — beyond upstream NetworkPolicy, and worth knowing if you standardise on Calico.

## 4. Pod Security Admission — the built-in control, free of charge

Before reaching for a policy engine: Kubernetes has enforcement built in. **Pod Security Admission** (which replaced PodSecurityPolicy in 1.25) applies the Pod Security Standards via nothing more than **namespace labels**.

Three profiles: `privileged` (no restrictions), `baseline` (blocks known escalations — privileged containers, host namespaces, hostPath), and `restricted` (hardened — non-root, all capabilities dropped, seccomp `RuntimeDefault`, no privilege escalation).

```bash
kubectl label namespace payments \
  pod-security.kubernetes.io/enforce=baseline \
  pod-security.kubernetes.io/warn=restricted \
  pod-security.kubernetes.io/audit=restricted
```

That combination is the migration pattern worth copying: **enforce what already passes, warn on what you're moving toward.** You get hard enforcement at `baseline` immediately, plus a warning on every `kubectl apply` listing exactly what would fail under `restricted` — a free, zero-risk gap analysis before you tighten the enforce label.

Test it:

```bash
kubectl run privileged-pod --image=nginx:1.29 -n payments \
  --overrides='{"spec":{"containers":[{"name":"x","image":"nginx:1.29","securityContext":{"privileged":true}}]}}'
# Error from server (Forbidden): pods "privileged-pod" is forbidden:
# violates PodSecurity "baseline:latest": privileged (container "x" must not set securityContext.privileged=true)
```

Two caveats. PSA is **namespace-scoped only** — there's no way to express "restricted everywhere" in one object, so a new namespace is `privileged` unless someone labels it (which is itself a good use for a Kyverno policy). And it only validates the Pod Security Standards; anything outside that fixed set needs a policy engine.

The `restricted` profile is essentially the hardened `securityContext` from the [container security post](/blog/devsecops-container-security), enforced at admission instead of hoped for in review.

## 5. Kyverno — policy as code

Kyverno is a Kubernetes-native policy engine that **validates**, **mutates**, and **generates** resources, with policies written in YAML rather than a separate language (the main reason it tends to win over OPA/Gatekeeper's Rego on adoption speed).

```bash
kubectl apply --server-side -f https://github.com/kyverno/kyverno/releases/latest/download/install.yaml
kubectl -n kyverno rollout status deployment/kyverno-admission-controller --timeout=180s
```

### The no-latest-tag policy, done properly

The commonly-circulated version of this policy has a real gap. It checks `image: "!*:latest"` — so `nginx:latest` is rejected, but a **bare `nginx` with no tag passes**, despite Docker resolving it to exactly the same `:latest` image. The upstream policy therefore uses **two rules**: one requiring a tag at all, one rejecting `latest`.

```bash
kubectl apply -f - <<'EOF'
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-latest-tag
spec:
  background: true
  rules:
    - name: require-image-tag
      match:
        any:
          - resources:
              kinds: ["Pod"]
      validate:
        failureAction: Enforce
        message: "An image tag is required."
        foreach:
          - list: "request.object.spec.containers"
            pattern:
              image: "*:*"
          - list: "request.object.spec.initContainers"
            pattern:
              image: "*:*"
    - name: validate-image-tag
      match:
        any:
          - resources:
              kinds: ["Pod"]
      validate:
        failureAction: Enforce
        message: "Using a mutable image tag e.g. 'latest' is not allowed."
        foreach:
          - list: "request.object.spec.containers"
            pattern:
              image: "!*:latest"
          - list: "request.object.spec.initContainers"
            pattern:
              image: "!*:latest"
EOF
```

Two syntax points that have moved:

- **`failureAction` belongs on the rule now.** The policy-level `spec.validationFailureAction` was **deprecated in Kyverno 1.13** in favour of `spec.rules[*].validate.failureAction`. Old policies still work, but new ones shouldn't use it.
- **`match.any` is the current form.** The bare `match: { resources: ... }` shape is the legacy one.

Also note `foreach` over the container list rather than a positional `containers: [...]` pattern — that's what makes the rule apply to *every* container, including init containers, rather than just the first.

Test both halves:

```bash
kubectl run bad-tag  --image=nginx:latest -n payments   # blocked: mutable tag
kubectl run no-tag   --image=nginx        -n payments   # blocked: tag required
kubectl run good-pod --image=nginx:1.29   -n payments   # created
```

That middle case is the one the single-rule version lets through.

### Start in Audit, not Enforce

On a real cluster, `failureAction: Enforce` on day one blocks deployments and makes the security team unpopular. Ship as `Audit`, watch the policy reports, fix the violations, then flip:

```bash
kubectl get policyreport -A
kubectl get clusterpolicyreport
```

### Where Kyverno earns its place

Validation alone is increasingly doable in-tree: **ValidatingAdmissionPolicy** (CEL-based, GA since 1.30) runs inside the API server with no webhook to deploy, secure, or keep highly available — and no `failurePolicy: Fail` outage mode ([Extending Kubernetes](/blog/k8s-extensibility)). For straightforward validation, prefer it.

Kyverno is worth the operational cost when you need what VAP can't do:

- **Mutation** — inject default labels, `securityContext` fields, or sidecars automatically.
- **Generation** — auto-create a default-deny NetworkPolicy or a resource quota in every new namespace. That directly fixes PSA's "new namespaces are unprotected" gap.
- **Image verification** — `verifyImages` rules that reject any image not signed by your pipeline's identity, which is what turns the Cosign signing from the [container security post](/blog/devsecops-container-security) into an actual enforced control rather than metadata nobody checks.
- **Policy reports** — cluster-wide compliance reporting as first-class objects.

One operational warning: Kyverno is an **admission webhook**, so it sits in the critical path of every matching API request. A Kyverno outage with `failurePolicy: Fail` can block Pod creation cluster-wide. Run it with multiple replicas and keep `kube-system` excluded.

## 6. Secrets — and the sentence to unlearn

The most common mistaken claim about Kubernetes Secrets is that they "store sensitive data safely, base64 encoded." **Base64 is encoding, not encryption.** It's there so binary data survives YAML, and it's reversible by anyone in one command:

```bash
kubectl create namespace dev

kubectl create secret generic db-secret \
  --from-literal=username=admin \
  --from-literal=password=StrongPassword123 \
  -n dev

kubectl get secret db-secret -n dev -o jsonpath='{.data.password}' | base64 -d
# StrongPassword123
```

(The `kubectl create namespace dev` is easy to miss — the `dev` namespace doesn't exist from section 1, which created `payments` and `search`.)

Consuming a Secret as environment variables:

```bash
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: secret-demo
  namespace: dev
spec:
  containers:
    - name: app
      image: busybox:1.37
      command: ["sh", "-c", "sleep 3600"]
      env:
        - name: DB_USER
          valueFrom:
            secretKeyRef: { name: db-secret, key: username }
        - name: DB_PASS
          valueFrom:
            secretKeyRef: { name: db-secret, key: password }
EOF
```

The original version of this demo runs `env && sleep 3600` and then reads the value back with `kubectl logs`. It's an effective demonstration, and it's also **exactly the anti-pattern to never ship** — a container that prints its environment at startup writes every credential it holds into your log aggregator, where it's indexed, retained, and readable by everyone with log access. Verify with `kubectl exec` instead:

```bash
kubectl exec -n dev secret-demo -- printenv DB_USER
```

Three practices that follow from Secrets being weakly protected:

- **Enable encryption at rest.** Without an `EncryptionConfiguration`, Secrets sit in etcd in plaintext — an etcd backup is a credential dump. Managed clusters make this a checkbox (EKS with KMS, AKS with Key Vault); details in [Kubernetes Security & RBAC](/blog/k8s-security-rbac) and [Secrets & Configuration on EKS](/blog/eks-secrets-configuration-configmaps-encryption).
- **Prefer file mounts over environment variables.** Env vars leak through crash dumps, `/proc/<pid>/environ`, child processes, and debug endpoints. A mounted file also updates in place when the Secret changes; env vars are fixed at container start.
- **Lock down `get secrets` in RBAC** — the point from section 2, applied.

## 7. Git-safe secrets: External Secrets Operator + Vault

Everything above still leaves the GitOps problem: a Secret manifest can't go in Git, because base64 isn't encryption and anyone with repo access decodes it in seconds.

**External Secrets Operator** solves it by inverting what's stored. The secret lives in an external store; Git holds only a **reference**; ESO reconciles that reference into a native Kubernetes Secret:

1. Secret stored in Vault (or AWS Secrets Manager, Azure Key Vault, GCP Secret Manager)
2. Git contains an `ExternalSecret` — a pointer, no secret material
3. ESO syncs it into a real Kubernetes Secret
4. Pods consume it as a normal Secret, with no application change

### Install ESO

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

helm install external-secrets external-secrets/external-secrets \
  -n external-secrets --create-namespace --wait

kubectl get pods -n external-secrets
```

That `helm install` is the step most walkthroughs drop — `helm repo add` and `helm repo update` only register the chart repository locally. Without the install, `kubectl get pods -n external-secrets` returns `No resources found` and the `SecretStore` you apply next fails with "no matches for kind".

### Vault in dev mode

```bash
kubectl create namespace vault

kubectl apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vault
  namespace: vault
spec:
  replicas: 1
  selector:
    matchLabels: { app: vault }
  template:
    metadata:
      labels: { app: vault }
    spec:
      containers:
        - name: vault
          image: hashicorp/vault:1.20
          args: ["server", "-dev"]
          env:
            - name: VAULT_DEV_ROOT_TOKEN_ID
              value: root
            - name: VAULT_DEV_LISTEN_ADDRESS
              value: "0.0.0.0:8200"
          ports:
            - containerPort: 8200
EOF

kubectl expose deployment vault -n vault --port=8200 --name=vault
kubectl -n vault rollout status deployment/vault --timeout=120s
```

`-dev` mode is **in-memory, unsealed, and auth-free** — restart the Pod and every secret is gone. Perfect for a lab, catastrophic anywhere else.

Write a secret:

```bash
kubectl exec -n vault deploy/vault -- sh -c '
  export VAULT_ADDR=http://127.0.0.1:8200
  export VAULT_TOKEN=root
  vault kv put secret/payments/db username=admin password=SuperSecret123
'
```

### Wire up ESO

```bash
kubectl create secret generic vault-token \
  --from-literal=token=root -n payments
```

```bash
kubectl apply -f - <<'EOF'
apiVersion: external-secrets.io/v1
kind: SecretStore
metadata:
  name: vault-backend
  namespace: payments
spec:
  provider:
    vault:
      server: "http://vault.vault.svc.cluster.local:8200"
      path: "secret"
      version: "v2"
      auth:
        tokenSecretRef:
          name: vault-token
          key: token
EOF
```

**This is the lab's deliberate compromise, and it's worth naming.** Authenticating ESO with a static root token stored in a Kubernetes Secret means you created a Secret in order to avoid creating Secrets — the bootstrapping problem, unsolved, with the most privileged token Vault has.

Production uses **workload identity** instead: Vault's Kubernetes auth method, where ESO presents its ServiceAccount token and Vault validates it against the API server, issuing a short-lived, narrowly-scoped token. No static credential anywhere. On managed clusters it's cleaner still — [EKS Pod Identity](/blog/accessing-aws-secrets-manager-from-eks-with-pod-identity-with-auto-sync) or AKS Workload Identity means ESO authenticates to AWS Secrets Manager or Key Vault with no stored credential at all, which is the setup I'd actually reach for.

Now the object that's safe to commit:

```bash
kubectl apply -f - <<'EOF'
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: db-secret
  namespace: payments
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: SecretStore
  target:
    name: db-secret
    creationPolicy: Owner
  data:
    - secretKey: username
      remoteRef:
        key: payments/db
        property: username
    - secretKey: password
      remoteRef:
        key: payments/db
        property: password
EOF
```

```bash
kubectl get externalsecret -n payments
# NAME        STORE           REFRESH   STATUS         READY
# db-secret   vault-backend   1h        SecretSynced   True

kubectl get secret db-secret -n payments \
  -o jsonpath='{.data.password}' | base64 -d
# SuperSecret123
```

Read `READY: True` before anything else — a typo'd Vault path leaves the ExternalSecret `SecretSyncedError` with the reason in `kubectl describe externalsecret`, and no Secret created at all.

Points that matter in practice:

- **`creationPolicy: Owner`** makes ESO the owner via an owner reference, so deleting the `ExternalSecret` deletes the generated Secret ([owner references and cascading deletion](/blog/k8s-labels-metadata-kubeconfig)). Use `Merge` when adding keys to a Secret you don't own.
- **`refreshInterval: 1h` is a poll, not a push.** A rotated secret takes up to an hour to appear, and *the Pod still holds the old value* — env vars never change after start, and even mounted files need the app to re-read them. Rotation needs a rollout ([Reloader](https://github.com/stakater/Reloader) or a checksum annotation) or an app that reloads.
- **`ClusterSecretStore`** is the cluster-scoped variant, so you define the Vault connection once instead of per namespace.
- **The generated Secret is still an ordinary Kubernetes Secret** — base64, in etcd. ESO fixes *Git* exposure, not at-rest exposure. You still want encryption at rest and tight RBAC.

The Vault-in-Terraform equivalent of this same caveat — a Vault-sourced value still landing in plaintext in `terraform.tfstate` — is in the [IaC security post](/blog/devsecops-iac-security).

## 8. What this lab deliberately leaves out

Honest scoping, so the gaps are known rather than assumed covered:

- **Runtime security.** Everything here is admission-time or network-layer. Detecting a container that *starts behaving* maliciously needs eBPF-based runtime detection — Falco, Tetragon ([EKS Security & Compliance](/blog/eks-security-compliance)).
- **Audit logging.** The API server audit log is what answers "who deleted that?". Not configurable on kind's control plane without extra work, and on by default in EKS/AKS.
- **Control-plane and node hardening.** etcd encryption and TLS, kubelet authn/authz, CIS benchmarks via `kube-bench`, and blocking IMDS access from Pods — the single most common cloud-credential theft path on EKS.
- **Supply chain.** Image scanning, SBOMs, and signature verification at admission — covered end to end in [container security](/blog/devsecops-container-security).
- **Resource quotas and LimitRange.** Denial of service is a security concern; one namespace consuming a cluster is an availability incident ([Resource Management](/blog/k8s-resource-management)).

## Cleanup

```bash
kind delete cluster --name k8s-security
```

## The layered picture

| Layer | Control | Fails how? |
| --- | --- | --- |
| **Scoping** | Namespaces | Silently — no isolation on their own |
| **Identity** | RBAC, least privilege, no token automount | Closed — deny by default |
| **Network** | Default-deny NetworkPolicy + explicit allows | **Open** — silently, with no CNI |
| **Workload** | Pod Security Admission (`baseline` → `restricted`) | Closed — but only in labelled namespaces |
| **Policy** | Kyverno / ValidatingAdmissionPolicy | Configurable — `failurePolicy` decides |
| **Secrets** | ESO + external store, encryption at rest | Open — base64 is not encryption |
| **Runtime** | Falco, audit logs | Detection only, not prevention |

Two things worth carrying out of this lab. First, **defence in depth is not a slogan here** — RBAC doesn't help against a network-level attack, NetworkPolicy doesn't help against an over-permissioned ServiceAccount, and PSA doesn't help against a secret committed to Git. Each layer covers a different failure, and each assumes the others will eventually fail.

Second, **verify every control from the wrong side.** The four mistakes this post corrects — a CNI that ignores NetworkPolicy, an RBAC test against a nonexistent identity, a policy that misses untagged images, an operator that was never installed — all produce output that looks like success. A control you haven't watched *block* something is a control you're guessing about.

This completes the DevSecOps series so far: [Git & GitHub](/blog/devsecops-git-github-security) for the source, [IaC](/blog/devsecops-iac-security) for the infrastructure, [containers](/blog/devsecops-container-security) for the images, and this for the platform they all run on.
