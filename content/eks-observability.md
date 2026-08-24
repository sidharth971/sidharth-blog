---
title: "Observability on EKS: CloudWatch, Prometheus/Grafana, and Logging"
slug: eks-observability-cloudwatch-prometheus
category: AWS
subcategory: EKS
tags: aws, eks, kubernetes, observability, cloudwatch, prometheus, opentelemetry
excerpt: The current (2026) way to wire up Container Insights via the managed add-on, when to reach for self-hosted Prometheus/Grafana instead, control-plane audit logging, and where OpenTelemetry fits across both.
status: published
---

Deployments rolling out safely (the [previous post](/blog/eks-deployment-strategies)) only matters if you can actually tell whether the result is healthy. This post is the observability stack: metrics, logs, and traces.

## CloudWatch Container Insights: now a managed add-on

The old way to get Container Insights on EKS was manually installing the CloudWatch agent and Fluent Bit as DaemonSets. The current way is the **CloudWatch Observability EKS add-on** — installed the same way as any other managed add-on (VPC CNI, CoreDNS, the Pod Identity agent from earlier in this series):

```bash
aws eks create-addon --cluster-name sidhu-cluster --addon-name amazon-cloudwatch-observability
```

It deploys the ADOT (AWS Distro for OpenTelemetry) collector under the hood, pulling metrics from cAdvisor, kube-state-metrics, Node Exporter, and (if present) NVIDIA DCGM/AWS Neuron Monitor for accelerator workloads, and ships them to CloudWatch at 30-second granularity with cluster/node/pod metadata attached automatically. As of 2026, there's also an **OTel-based Container Insights** variant in preview that publishes the same data over OTLP alongside (not instead of) the legacy metrics path — worth knowing it exists, not yet something to depend on as the only path while it's in preview.

This is the lowest-effort option specifically because it's "already AWS" — no separate account, no extra infrastructure to run, dashboards show up in the CloudWatch console immediately.

## Prometheus + Grafana: when to self-host instead

Reach for a self-hosted (or managed, e.g. Amazon Managed Prometheus/Grafana) Prometheus stack when you need things CloudWatch's model doesn't give you as naturally: PromQL as the actual query language your team already knows, portability if there's ever a multi-cloud or on-prem requirement, or the enormous existing ecosystem of Grafana dashboards and Prometheus exporters built by the open-source community for specific tools (databases, message queues, ingress controllers) that CloudWatch doesn't have curated equivalents for.

The trade-off is operational: Prometheus needs its own storage/retention story (or a managed remote-write target), and unlike the CloudWatch add-on, you're now responsible for keeping the monitoring stack itself healthy. Amazon Managed Service for Prometheus removes the storage-operations part of that trade-off while keeping the PromQL/Grafana ecosystem benefit.

## Logging: Fluent Bit and where logs actually go

Application and container logs ship via **Fluent Bit** (the de facto standard log forwarder on EKS — lighter weight than the older Fluentd, though both exist) running as a DaemonSet, tailing container stdout/stderr and forwarding to a destination — CloudWatch Logs, an OpenSearch domain, or a third-party log platform. The CloudWatch Observability add-on above includes a Fluent Bit configuration out of the box if CloudWatch Logs is the target.

## Control plane logging: audit, api, authenticator

Separately from *your workloads'* logs, EKS can stream **control plane logs** — API server, audit, authenticator, controller manager, scheduler — to CloudWatch Logs. These aren't enabled by default (each log type has a cost), and the one most worth turning on deliberately is **audit**: it records every request to the Kubernetes API, which is what you'd actually want during a security investigation ("who deleted this Secret, and when") — connecting directly back to the RBAC and access-entry material from the [Identity & Access post](/blog/eks-identity-access-irsa-pod-identity-rbac).

```bash
aws eks update-cluster-config --name sidhu-cluster \
  --logging '{"clusterLogging":[{"types":["api","audit","authenticator"],"enabled":true}]}'
```

## OpenTelemetry: the common layer underneath

**OpenTelemetry (OTel)** is the vendor-neutral instrumentation and collection standard that both paths above increasingly sit on — the ADOT collector powering the CloudWatch add-on *is* an OpenTelemetry Collector distribution, and Amazon Managed Prometheus/Grafana can ingest OTLP directly too. For distributed tracing specifically (following a single request across multiple services), instrumenting application code with the OpenTelemetry SDK and exporting via OTLP to whichever backend you've chosen is the standard approach — traces are the one observability pillar that CloudWatch Container Insights and a bare Prometheus/Grafana stack both still need something like Jaeger, Tempo, or X-Ray added to actually visualize.

## The cheap diagnostics that come before all of this

Before reaching for dashboards, `kubectl` itself answers a lot of "is this healthy" questions directly against the live cluster:

```bash
kubectl top nodes
kubectl top pods -n sidhu-ns
kubectl get events -n sidhu-ns --sort-by='.lastTimestamp'
```

`kubectl top` needs `metrics-server` running (the same component the HPA from the [Compute Scaling post](/blog/eks-compute-scaling-hpa-vpa-karpenter-keda) depends on) — worth confirming that's healthy first if these commands come back empty, since a broken metrics-server silently breaks both HPA and `kubectl top` at once.

## Next up

[Security & Compliance](/blog/eks-security-compliance) — Pod Security Standards, image scanning, and admission control.
