---
title: "Kubernetes Deployment Strategies: Rolling, Recreate, Blue/Green, Canary, A/B, and Shadow"
slug: k8s-deployment-strategies
category: Kubernetes
tags: kubernetes, k8s, deployment, canary, blue-green, rollout
excerpt: The two strategies Kubernetes implements natively, the four it doesn't, and what maxSurge/maxUnavailable actually do — plus why readiness probes are what make any of it safe.
status: published
---

*Post 10 of an 18-part Kubernetes concepts series.* ← [Autoscaling](/blog/k8s-autoscaling) · → [Health & Lifecycle](/blog/k8s-health-lifecycle)

An important distinction up front: Kubernetes natively implements exactly **two** of the strategies below — `RollingUpdate` and `Recreate`. Everything else (blue/green, canary, A/B, shadow) is a *pattern* you build from Services, labels, ingress/Gateway routing, or a dedicated controller. Docs that present all six as built-in features cause a lot of confusion.

## RollingUpdate — the default

New Pods come up gradually while old ones are removed, controlled by two knobs:

```yaml
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%          # extra Pods allowed above desired count
      maxUnavailable: 25%    # Pods allowed to be missing during the rollout
```

- **`maxSurge`** — how many *extra* Pods can exist during the transition. Higher = faster rollout, more peak resource use.
- **`maxUnavailable`** — how many Pods may be unavailable. Set to `0` (with `maxSurge` ≥ 1) for a genuinely zero-capacity-loss rollout: every new Pod becomes Ready before any old one is removed.

The mechanic underneath, from [Core Objects](/blog/k8s-core-objects): the Deployment creates a **new ReplicaSet** and shifts replicas from old to new. The old ReplicaSet is kept at zero replicas (up to `revisionHistoryLimit`), which is what makes rollback instant — it just scales the old one back up.

```bash
kubectl rollout status deployment/api
kubectl rollout undo deployment/api
kubectl rollout undo deployment/api --to-revision=3
```

Also worth setting: `minReadySeconds` (a Pod must stay Ready this long before counting as available — catches processes that pass readiness then immediately crash) and `progressDeadlineSeconds` (mark the rollout failed if it stalls, instead of hanging indefinitely).

**A rolling update is only safe if readiness probes are correct.** Without a readiness probe, Kubernetes considers a Pod ready the moment the container starts — so it removes an old Pod and sends traffic to a new one that hasn't finished booting. Most "rolling deploys cause errors" reports are actually missing or wrong readiness probes ([Health & Lifecycle](/blog/k8s-health-lifecycle)).

## Recreate

Terminate everything old, then start everything new:

```yaml
spec:
  strategy:
    type: Recreate
```

Guaranteed downtime, deliberately. The reason to choose it is when old and new versions genuinely **cannot coexist** — an incompatible database schema migration, or a singleton holding an exclusive lock (or an `RWO`/`ReadWriteOncePod` volume that can't be attached to old and new Pods simultaneously, per [Storage](/blog/k8s-storage)).

## Blue/green

Two complete environments; traffic switches all at once.

Implementation in plain Kubernetes is a **Service selector flip**: run two Deployments labeled `version: blue` and `version: green`, with the Service selecting one of them.

```yaml
spec:
  selector:
    app: api
    version: blue      # change to "green" to cut over instantly
```

What it buys: the new version is fully deployed and testable (via a separate preview Service) before any production traffic hits it, and rollback is a one-field change back. The cost is running double capacity through the transition, and — the part people forget — the cutover is **instantaneous for everyone**, so a bad version that passed testing affects 100% of users at once.

## Canary

Route a small percentage of traffic to the new version, watch, then progressively shift more.

A crude version works with plain Deployments and replica counts: 9 replicas of stable + 1 replica of canary behind the same Service ≈ 10% of traffic. It's approximate — traffic split is a function of replica ratio, so fine-grained percentages mean absurd replica counts.

The real implementation uses **traffic-weighted routing**. Gateway API makes this native ([Networking](/blog/k8s-networking)):

```yaml
backendRefs:
  - name: api-stable
    port: 80
    weight: 95
  - name: api-canary
    port: 80
    weight: 5
```

For automated progressive rollouts — shift weight, evaluate metrics, promote or roll back without a human — you want a controller: **Argo Rollouts** (replaces the Deployment with a `Rollout` CRD offering explicit stepped promotion and manual gates) or **Flagger** (keeps your Deployment and layers a `Canary` resource that automates promotion based on metric analysis). Comparison and the AWS specifics are in [Deployment Strategies on EKS](/blog/eks-deployment-strategies).

## A/B testing

Superficially similar to canary, but the intent is different — and so is the routing rule.

**Canary splits by percentage to reduce risk**: is this build healthy? **A/B splits by user attribute to compare behaviour**: does variant B convert better? Routing is by header, cookie, or user ID rather than random weight:

```yaml
matches:
  - headers:
      - name: x-user-segment
        value: beta
```

Canary is a deployment safety mechanism; A/B is a product experiment that happens to use the same routing machinery. Conflating them leads to reading conversion metrics off a rollout, or rolling back a deploy because an experiment underperformed.

## Shadow / dark launch

Send a **copy** of real production traffic to the new version, and **discard its responses**. Users are unaffected — they're served entirely by the stable version — while the new one gets exercised with real traffic patterns.

This is the strongest pre-release signal available: real request shapes, real payload sizes, real concurrency, zero user risk. It needs a service mesh or proxy capable of mirroring (Istio calls it traffic mirroring — see [Service Mesh](/blog/k8s-service-mesh)).

The critical caveat: **the shadowed version must not cause side effects.** If it writes to the same database, charges the same payment provider, or sends the same emails, you've just doubled every write in production. Shadow testing requires either a fully isolated dependency set or an application that's genuinely read-only in shadow mode.

## Choosing

- **Rolling** — the default for stateless services. Correct readiness probes, `maxUnavailable: 0` when capacity matters.
- **Recreate** — only when versions truly can't coexist.
- **Blue/green** — when you need to validate the full deployment before any traffic, and can afford double capacity.
- **Canary** — when a bad release is expensive enough to justify progressive exposure and automated analysis.
- **A/B** — product experiments, not deployment safety.
- **Shadow** — high-risk rewrites where you need real traffic validation before serving a single user.

## On EKS and AKS

Rolling and Recreate are upstream and identical. The rest depend on the **traffic-routing layer**, which is where the clouds differ:

- **EKS** — the AWS Load Balancer Controller supports ALB weighted target groups, so Argo Rollouts can shift canary weight at the ALB without a service mesh. Details in [Load Balancing and Ingress on EKS](/blog/eks-load-balancing-ingress-alb-nlb-gateway-api).
- **AKS** — the Application Routing add-on (managed NGINX) supports canary annotations; Application Gateway for Containers and the Istio-based service mesh add-on cover weighted and header-based routing.

Both now support Gateway API, which is the portable way to express weighted routing — the same `HTTPRoute` with `weight` fields works on either, which is a real argument for standardizing on it rather than cloud-specific ingress annotations. Argo Rollouts and Flagger run on both clusters unchanged; only the traffic-provider config differs.

---

*Next:* [Health & Lifecycle: Probes, Hooks, Pod Phases, and Graceful Termination](/blog/k8s-health-lifecycle)
