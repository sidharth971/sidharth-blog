---
title: Accessing AWS Secrets Manager from EKS with Pod Identity (with Auto-Sync)
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, secrets-manager, pod-identity, secrets-store-csi-driver
excerpt: Step-by-step setup for pulling AWS Secrets Manager secrets into EKS pods via the Secrets Store CSI Driver, authenticated with Pod Identity, with the mounted secret staying in sync automatically when the value changes.
status: published
---

Continuing from the [ALB/Ingress setup](/blog/path-based-routing-on-eks-with-the-aws-load-balancer-controller-pod-identity) on this same cluster — this time it's about getting secrets out of **AWS Secrets Manager** and into pods, without baking credentials into anything and without a redeploy every time a secret rotates.

The pattern is the **AWS Secrets and Configuration Provider (ASCP)** for the **Secrets Store CSI Driver**, authenticated via the **Pod Identity agent** that's already running on the cluster from the last post. Same trust-policy shape as the ALB controller, same `pods.eks.amazonaws.com` principal — but this time the IAM role attaches to the *workload's own* service account, not a controller's.

## How it fits together

1. Pod Identity assigns an IAM role to the pod (via its service account).
2. The CSI driver's AWS provider (ASCP) uses that role to call Secrets Manager on the pod's behalf.
3. If authorized, ASCP mounts the secret as a file inside the pod — and, optionally, mirrors it into a native Kubernetes `Secret` too.
4. A **rotation reconciler** re-polls Secrets Manager on an interval and updates the mount (and the mirrored `Secret`) if the value changed — this is the "auto-sync" part. It's poll-based, not an instant push, so set the interval intentionally.

## Prerequisites

- EKS 1.24+ (Pod Identity requirement) — already true for this cluster.
- The **Pod Identity agent** add-on installed (done in the previous post; if starting fresh: `eksctl create addon --name eks-pod-identity-agent --cluster $CLUSTER --region $REGION`).
- A secret already in Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name sidhu-ns/app-db-credentials \
  --secret-string '{"username":"appuser","password":"change-me"}'
```

## 1. Install the Secrets Store CSI Driver (with auto-rotation enabled)

```bash
helm repo add secrets-store-csi-driver https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts
helm repo update

helm install csi-secrets-store secrets-store-csi-driver/secrets-store-csi-driver \
  -n kube-system \
  --set syncSecret.enabled=true \
  --set enableSecretRotation=true \
  --set rotationPollInterval=2m
```

- `enableSecretRotation` + `rotationPollInterval` is what gives you auto-sync: the driver re-fetches from Secrets Manager every 2 minutes and updates the mounted file if it changed.
- `syncSecret.enabled=true` additionally mirrors the mounted content into a real Kubernetes `Secret` object, so it's usable as an env var, not just a file — see the caveat in [Auto-sync in practice](#auto-sync-in-practice) below before you rely on that for env vars.

## 2. Install the AWS provider (ASCP)

```bash
kubectl apply -f https://raw.githubusercontent.com/aws/secrets-store-csi-driver-provider-aws/main/deployment/aws-provider-installer.yaml

kubectl -n kube-system get pods -l app=csi-secrets-store-provider-aws
```

## 3. IAM policy, role, and the Pod Identity association

Scope the policy to the specific secret, not `*`:

```bash
cat > secrets-read-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      "Resource": "arn:aws:secretsmanager:*:*:secret:sidhu-ns/app-db-credentials-*"
    }
  ]
}
EOF

aws iam create-policy \
  --policy-name SidhuNsSecretsReadPolicy \
  --policy-document file://secrets-read-policy.json
```

Same trust policy shape as the ALB controller — the principal is the Pod Identity service, not an OIDC provider:

```bash
cat > secrets-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "pods.eks.amazonaws.com" },
      "Action": ["sts:AssumeRole", "sts:TagSession"]
    }
  ]
}
EOF

aws iam create-role \
  --role-name SidhuNsSecretsReaderRole \
  --assume-role-policy-document file://secrets-trust.json

aws iam attach-role-policy \
  --role-name SidhuNsSecretsReaderRole \
  --policy-arn arn:aws:iam::$ACCOUNT_ID:policy/SidhuNsSecretsReadPolicy
```

**This is the part that trips people up:** the association binds to the *application's* service account, not the CSI driver's or the provider's.

```bash
kubectl -n sidhu-ns create serviceaccount app-sa

aws eks create-pod-identity-association \
  --cluster-name $CLUSTER \
  --namespace sidhu-ns \
  --service-account app-sa \
  --role-arn arn:aws:iam::$ACCOUNT_ID:role/SidhuNsSecretsReaderRole
```

## 4. SecretProviderClass and the Deployment

The only field that differs from an IRSA-based setup is `usePodIdentity: "true"`:

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: app-db-credentials
  namespace: sidhu-ns
spec:
  provider: aws
  parameters:
    objects: |
      - objectName: "sidhu-ns/app-db-credentials"
        objectType: "secretsmanager"
    usePodIdentity: "true"
```

Reference it from the pod via a CSI volume, using the service account from step 3:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
  namespace: sidhu-ns
spec:
  replicas: 2
  selector:
    matchLabels: { app: app }
  template:
    metadata:
      labels: { app: app }
    spec:
      serviceAccountName: app-sa
      containers:
        - name: app
          image: your-app-image:latest
          volumeMounts:
            - name: secrets-store-inline
              mountPath: "/mnt/secrets-store"
              readOnly: true
      volumes:
        - name: secrets-store-inline
          csi:
            driver: secrets-store.csi.k8s.io
            readOnly: true
            volumeAttributes:
              secretProviderClass: "app-db-credentials"
```

## 5. Verify the mount

```bash
kubectl -n sidhu-ns apply -f secretproviderclass.yaml
kubectl -n sidhu-ns apply -f app-deployment.yaml

POD=$(kubectl -n sidhu-ns get pods -l app=app -o jsonpath='{.items[0].metadata.name}')
kubectl -n sidhu-ns exec -it $POD -- cat /mnt/secrets-store/sidhu-ns/app-db-credentials
```

## Auto-sync in practice

This is the part worth being precise about, since "auto-sync" means different things depending on how the pod consumes the secret:

- **File mount (`/mnt/secrets-store/...`)** — updates live. The rotation reconciler re-fetches on `rotationPollInterval` and kubelet re-publishes the volume; the app just needs to re-read the file (or watch it) to pick up the new value. No pod restart.
- **Synced Kubernetes `Secret` (via `syncSecret.enabled=true`), consumed as an env var** — the `Secret` object itself updates on the same interval, but **environment variables are only injected at container start**. A pod that's already running won't see the new value until it restarts. If you're relying on this path, pair it with something like [Reloader](https://github.com/stakater/Reloader) to watch the `Secret` and trigger a rolling restart automatically — otherwise "auto-sync" quietly stops at the Secret object and never reaches the running process.

If your app can tail a file for changes, prefer the file-mount path — it's the only one that's actually restart-free end to end.

## Production checklist

- Scope the IAM policy to specific secret ARNs (or tag-based conditions), never `secretsmanager:*` on `*`.
- Pick `rotationPollInterval` deliberately — shorter intervals mean faster propagation but more API calls against Secrets Manager; 2m is a reasonable default, tune per secret sensitivity.
- If the cluster is private (as in the [previous post](/blog/path-based-routing-on-eks-with-the-aws-load-balancer-controller-pod-identity)), confirm the VPC has an STS interface VPC endpoint — Pod Identity's `AssumeRole` calls need to reach STS, and a private cluster with no NAT/STS endpoint will fail silently at the IAM step, not the CSI step.
- For troubleshooting, check both sides: `kubectl describe pod/<pod>` for mount errors, and `kubectl -n kube-system logs pod/<csi-secrets-store-provider-aws-pod>` for ASCP-side auth/permission errors.
- Don't log or echo the mounted file contents in CI/CD or debug scripts — treat `/mnt/secrets-store/*` like any other secret material.
