---
title: Path-Based Routing on EKS with the AWS Load Balancer Controller (Pod Identity)
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, alb, ingress, pod-identity, load-balancer-controller
excerpt: A full runbook for path-based routing on EKS using the AWS Load Balancer Controller, authenticated via Pod Identity instead of IRSA — internal ALB, subnet tagging, IAM, and a verifiable two-app Ingress.
status: published
---

For path-based routing on EKS you need the **AWS Load Balancer Controller** — it watches your `Ingress` resources and provisions an ALB to match. Since our nodes and subnets are private, the ALB comes up **internal** by default; you'd only flip it to `internet-facing` if you have public subnets in the mix. And because the cluster already has the **Pod Identity agent** add-on installed, the controller gets its AWS permissions through a **Pod Identity association** instead of the older IRSA/OIDC dance — no OIDC provider setup required.

Here's the full flow, end to end.

## Flow overview

1. Tag subnets so the controller can discover them
2. Create an IAM policy + role, associate it via Pod Identity
3. Install the AWS Load Balancer Controller with Helm
4. Create a namespace + two nginx deployments + services
5. Create the path-based `Ingress`
6. Verify

Set these first:

```bash
export CLUSTER=<your-cluster-name>
export REGION=<your-region>
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export VPC_ID=$(aws eks describe-cluster --name $CLUSTER --region $REGION \
  --query "cluster.resourcesVpcConfig.vpcId" --output text)
```

## 1. Subnet tagging (the most common failure point)

The controller auto-discovers subnets by tags — get this wrong and the ALB either won't provision or lands in the wrong subnets. For an **internal ALB** (private subnets, our case):

```bash
# Apply to each PRIVATE subnet id
aws ec2 create-tags --resources <subnet-id-1> <subnet-id-2> \
  --tags Key=kubernetes.io/role/internal-elb,Value=1 \
         Key=kubernetes.io/cluster/$CLUSTER,Value=shared
```

If you want an **internet-facing** ALB instead, you need at least two **public** subnets in different AZs tagged `kubernetes.io/role/elb=1`, and you'd set `scheme: internet-facing` on the Ingress. A private-only VPC means internal-only, full stop.

## 2. IAM policy, role, and the Pod Identity association

```bash
# Latest official policy — check the tag against
# github.com/kubernetes-sigs/aws-load-balancer-controller/releases
curl -o iam_policy.json https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.13.0/docs/install/iam_policy.json

aws iam create-policy \
  --policy-name AWSLoadBalancerControllerIAMPolicy \
  --policy-document file://iam_policy.json
```

The trust policy for **Pod Identity** looks different from IRSA — the principal is `pods.eks.amazonaws.com`, not an OIDC provider ARN:

```bash
cat > lbc-trust.json <<'EOF'
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
  --role-name AmazonEKSLoadBalancerControllerRole \
  --assume-role-policy-document file://lbc-trust.json

aws iam attach-role-policy \
  --role-name AmazonEKSLoadBalancerControllerRole \
  --policy-arn arn:aws:iam::$ACCOUNT_ID:policy/AWSLoadBalancerControllerIAMPolicy

# Bind role -> service account via Pod Identity
aws eks create-pod-identity-association \
  --cluster-name $CLUSTER \
  --namespace kube-system \
  --service-account aws-load-balancer-controller \
  --role-arn arn:aws:iam::$ACCOUNT_ID:role/AmazonEKSLoadBalancerControllerRole
```

## 3. Install the controller (Helm)

With Pod Identity, the service account needs **no IAM annotation** at all — Helm just creates a plain service account and the association above handles credentials.

```bash
helm repo add eks https://aws.github.io/eks-charts
helm repo update

helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=$CLUSTER \
  --set region=$REGION \
  --set vpcId=$VPC_ID \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller

kubectl -n kube-system rollout status deploy/aws-load-balancer-controller
```

> Pod Identity credentials are injected on pod start. If the controller pods were already running before you created the association, restart them: `kubectl -n kube-system rollout restart deploy/aws-load-balancer-controller`.

## 4. Namespace, deployments, services

`workloads.yaml` — two nginx apps. Each mounts a ConfigMap so it serves distinct content **at its own path** (`/app1`, `/app2`), which is what actually makes path routing verifiable — plain nginx would 404 on `/app1` since that file doesn't exist by default.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: sidhu-ns
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: app1-content
  namespace: sidhu-ns
data:
  index.html: "<h1>App 1 — nginx</h1>"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: app2-content
  namespace: sidhu-ns
data:
  index.html: "<h1>App 2 — nginx</h1>"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-app1
  namespace: sidhu-ns
spec:
  replicas: 2
  selector:
    matchLabels: { app: nginx-app1 }
  template:
    metadata:
      labels: { app: nginx-app1 }
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          ports:
            - containerPort: 80
          volumeMounts:
            - name: content
              mountPath: /usr/share/nginx/html/app1   # serves at /app1/
          resources:
            requests: { cpu: "50m", memory: "64Mi" }
            limits:   { cpu: "200m", memory: "128Mi" }
          readinessProbe:
            httpGet: { path: /app1/, port: 80 }
            initialDelaySeconds: 5
            periodSeconds: 10
      volumes:
        - name: content
          configMap: { name: app1-content }
---
apiVersion: v1
kind: Service
metadata:
  name: nginx-app1-svc
  namespace: sidhu-ns
spec:
  selector: { app: nginx-app1 }
  ports:
    - port: 80
      targetPort: 80
  type: ClusterIP
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-app2
  namespace: sidhu-ns
spec:
  replicas: 2
  selector:
    matchLabels: { app: nginx-app2 }
  template:
    metadata:
      labels: { app: nginx-app2 }
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          ports:
            - containerPort: 80
          volumeMounts:
            - name: content
              mountPath: /usr/share/nginx/html/app2   # serves at /app2/
          resources:
            requests: { cpu: "50m", memory: "64Mi" }
            limits:   { cpu: "200m", memory: "128Mi" }
          readinessProbe:
            httpGet: { path: /app2/, port: 80 }
            initialDelaySeconds: 5
            periodSeconds: 10
      volumes:
        - name: content
          configMap: { name: app2-content }
---
apiVersion: v1
kind: Service
metadata:
  name: nginx-app2-svc
  namespace: sidhu-ns
spec:
  selector: { app: nginx-app2 }
  ports:
    - port: 80
      targetPort: 80
  type: ClusterIP
```

## 5. Ingress (path-based routing)

`ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: nginx-ingress
  namespace: sidhu-ns
  annotations:
    alb.ingress.kubernetes.io/scheme: internal              # internet-facing if you have public subnets
    alb.ingress.kubernetes.io/target-type: ip                # route to pod IPs directly
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80}]'
    alb.ingress.kubernetes.io/healthcheck-path: /
spec:
  ingressClassName: alb
  rules:
    - http:
        paths:
          - path: /app1
            pathType: Prefix
            backend:
              service:
                name: nginx-app1-svc
                port: { number: 80 }
          - path: /app2
            pathType: Prefix
            backend:
              service:
                name: nginx-app2-svc
                port: { number: 80 }
```

## 6. Deploy and verify

```bash
kubectl apply -f workloads.yaml
kubectl apply -f ingress.yaml

kubectl -n sidhu-ns get pods,svc,ingress
# Wait for ADDRESS to populate (~2-3 min while the ALB provisions):
kubectl -n sidhu-ns get ingress nginx-ingress -w

ALB=$(kubectl -n sidhu-ns get ingress nginx-ingress -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo $ALB
```

Because the ALB is **internal**, you can't just hit it from your laptop — test from inside the VPC (a bastion, or a throwaway pod):

```bash
kubectl -n sidhu-ns run curl --rm -it --image=curlimages/curl -- sh
# then, inside the pod:
curl http://$ALB/app1/
curl http://$ALB/app2/
```

**Testing without a bastion**, if you've got a route into the VPC some other way (VPN, peering, an EC2 box with the right SG), resolve the ALB hostname to a reachable IP locally instead of spinning up a curl pod every time:

```bash
echo "<reachable-ip> <alb-hostname>" | sudo tee -a /etc/hosts
```

then just `curl http://<alb-hostname>/app1/` directly. Handy for quick iteration, but it's a manual workaround, not a substitute for real internal DNS.

## Production checklist

- **`target-type: ip`** requires the VPC CNI (default on EKS) — pods must be reachable from the ALB's security group. The controller manages those SG rules automatically.
- **Internal ALB** is only reachable within the VPC, peered networks, or over VPN. If you expected public access, you need public subnets and `scheme: internet-facing`.
- Add **liveness** probes alongside readiness, and consider a `PodDisruptionBudget` for anything that isn't a demo.
- The ConfigMap-mounted content here is fine for static demo pages — don't reach for `emptyDir` for anything you actually need to persist.
- For HTTPS, add an ACM cert via `alb.ingress.kubernetes.io/certificate-arn`, switch `listen-ports` to `'[{"HTTPS":443}]'`, and add an HTTP→HTTPS redirect action.
- It's one ALB per Ingress by default. Use `alb.ingress.kubernetes.io/group.name` to share a single ALB across multiple Ingresses if you're running several path-routed apps and want to cut cost.
