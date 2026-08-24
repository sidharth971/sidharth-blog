---
title: "Connecting EKS to Databases: RDS, RDS Proxy, and ElastiCache"
slug: eks-database-integrations-rds
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, rds, elasticache, iam-authentication
excerpt: Reaching RDS and ElastiCache from pods safely — private subnets and security-group-scoped access, connection pooling with RDS Proxy, IAM database authentication as an alternative to static passwords, and why the data plane stays separate from the cluster.
status: published
---

Everything in this series so far has been about the cluster itself. Almost no real application is self-contained, though — this post is about the boundary between pods on this cluster and the databases they actually talk to.

## Private subnets, reached the same way as before

RDS and ElastiCache should sit in the private/isolated subnet tier from the [networking post](/blog/eks-networking-vpc-cni-deep-dive) — no route to the internet, reachable only from within the VPC. Access control follows the same security-group-reference pattern used throughout this series rather than CIDR ranges: the database's security group allows inbound only from the application's security group (or, with [Security Groups for Pods](/blog/eks-networking-vpc-cni-deep-dive), from the specific pods that need it) — not "anything in 10.0.0.0/16," which would let every pod on the cluster reach a database regardless of whether it has any business doing so.

## RDS Proxy: pooling for a scale-to-zero-shaped workload

Relational databases have a hard ceiling on concurrent connections, and Kubernetes workloads don't behave like a fixed set of application servers — HPA and Karpenter from the [Compute Scaling post](/blog/eks-compute-scaling-hpa-vpa-karpenter-keda) mean pod count (and therefore raw connection count, if each pod holds its own connections) can swing significantly. **RDS Proxy** sits between pods and the database, pooling and multiplexing connections so a burst of new pods doesn't translate 1:1 into a burst of new database connections that exhausts the instance's limit. It also holds connections open across brief database failovers, which shortens the application-visible downtime during a Multi-AZ RDS failover compared to connecting directly.

Worth adding specifically for workloads that scale aggressively (KEDA-driven queue consumers, HPA-scaled API services) — a small, fixed-replica-count service talking to RDS directly is less likely to need it.

## IAM database authentication

Instead of a static database password living in Secrets Manager (the pattern from earlier in this series) or, worse, a Kubernetes Secret nobody's rotating, **RDS IAM authentication** lets a pod generate a short-lived (15-minute) auth token via the AWS SDK, using the same Pod Identity credentials already covered in the [Identity & Access post](/blog/eks-identity-access-irsa-pod-identity-rbac) — the IAM policy grants `rds-db:connect` scoped to a specific database user, no password stored or rotated anywhere.

```json
{
  "Effect": "Allow",
  "Action": "rds-db:connect",
  "Resource": "arn:aws:rds-db:us-east-1:111122223333:dbuser:db-ABCDEFG/app_user"
}
```

The trade-off: token generation adds a small amount of latency to connection setup (negligible if using RDS Proxy or a connection pool, since it happens once per pooled connection, not per query), and not every database engine/driver combination supports it equally well. For anything where "no long-lived database credential exists anywhere" is worth that trade-off, it's a meaningfully stronger posture than even a well-rotated Secrets Manager password.

## ElastiCache

Same private-subnet, security-group-scoped access pattern as RDS. The main EKS-specific consideration is which client-side approach matches your cache topology: a cluster-mode-enabled Redis/Valkey setup needs a cluster-aware client (handling the hash-slot topology itself) rather than pointing at a single endpoint the way a non-clustered cache allows — a detail that's easy to get right in a quick test and wrong under real load if the client library isn't actually cluster-aware.

## The `ExternalName` pattern, revisited

The [Load Balancing post](/blog/eks-load-balancing-ingress-alb-nlb-gateway-api) mentioned `ExternalName` services briefly; this is the concrete use case it's for — giving an RDS endpoint (or any external dependency) a stable in-cluster DNS name (`db.internal.svc.cluster.local`) instead of hardcoding the actual RDS endpoint hostname into every application's config. If the underlying database ever moves (a restore to a new instance, a region migration), only the `ExternalName` Service needs updating, not every application's configuration.

## Why the data plane stays separate

A theme worth naming explicitly, now that this series has covered both sides: RDS and ElastiCache are deliberately **not** run as pods on this cluster. They're AWS-managed services living outside Kubernetes entirely, reached over the network like any other external dependency. This isn't a limitation — it's the same "separation of concerns" principle the [Terraform series' Day 27 notes](/blog/terraform-day-27-production-infrastructure) mention for infrastructure repos: the compute plane (this EKS cluster, ephemeral, frequently rescheduled, upgraded, even rebuilt) and the data plane (RDS, stateful, backed up, failover-aware) have fundamentally different lifecycles, and coupling them — running a production database as a StatefulSet on the same cluster that gets node-rotated during every version upgrade — trades away exactly the durability guarantees a managed database service exists to provide.

## Series wrap

That's deployment strategy, observability, security, and now the database boundary — the last of the four topics in this batch. Remaining in the series: Cost Optimization, Reliability & Operations, and CI/CD & Add-ons.
