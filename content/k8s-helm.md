---
title: "Helm: Charts, Templates, Values, and Releases"
slug: k8s-helm
category: Kubernetes
tags: kubernetes, k8s, helm, charts, packaging
excerpt: How Helm actually works — charts, the values-override chain, releases and revision history — plus the Helm 4 transition (GA since Nov 2025, with Helm 3 heading to EOL in 2027) and when Kustomize is the better fit.
status: published
---

*Post 15 of an 18-part Kubernetes concepts series.* ← [Observability](/blog/k8s-observability) · → [Service Mesh](/blog/k8s-service-mesh)

Raw YAML stops scaling the moment you need the same application in dev, staging, and production with different replica counts, image tags, and resource limits. Copy-pasting three near-identical manifest trees is how they drift apart. Helm is the most common answer to that.

## Chart

A **chart** is the package — a directory with a defined structure:

```
mychart/
├── Chart.yaml          # name, version, appVersion, dependencies
├── values.yaml         # default configuration
├── templates/          # templated manifests
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── _helpers.tpl    # reusable template snippets
│   └── NOTES.txt       # printed after install
└── charts/             # vendored subchart dependencies
```

Two versions in `Chart.yaml` that get confused constantly: **`version`** is the chart's own version (bump it when you change the templates), **`appVersion`** is the version of the software being deployed (bump it when the image tag changes). They move independently.

## Templates

Templates are Kubernetes manifests with Go templating. Values get substituted at render time:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "mychart.fullname" . }}
  labels:
    {{- include "mychart.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          {{- if .Values.env }}
          env:
            {{- toYaml .Values.env | nindent 12 }}
          {{- end }}
```

Three things worth knowing from that snippet: `{{-` trims preceding whitespace (YAML is indentation-sensitive, so this matters constantly), `nindent` indents a whole block to the right level, and `toYaml` serializes an arbitrary values structure — which is how you let users pass any resource spec without templating every field individually.

Built-in objects available in templates: `.Values` (merged values), `.Chart` (metadata), `.Release` (name, namespace, revision, isUpgrade/isInstall), and `.Capabilities` (cluster version and available API versions).

The debugging command that saves the most time:

```bash
helm template myapp ./mychart -f prod-values.yaml     # render locally, no cluster
helm install myapp ./mychart --dry-run --debug        # render + validate against the API
```

Rendering locally first turns "why did my release fail" into "here's the YAML I actually produced."

## Values and the override chain

`values.yaml` holds defaults; overrides layer on top, later winning:

1. Chart's own `values.yaml`
2. Parent chart values (for subcharts)
3. `-f custom-values.yaml` (multiple `-f` flags merge left to right)
4. `--set key=value` on the command line

```bash
helm install api ./mychart \
  -f values-prod.yaml \
  --set image.tag=1.9.2 \
  --set replicaCount=5
```

The practical pattern: a base `values.yaml` with safe defaults, plus one values file per environment, plus `--set` for the image tag your CI pipeline injects per build.

One caveat that surprises people: **maps merge, lists replace**. Overriding a list doesn't append to it — it substitutes the whole thing. That catches teams overriding a single element of an `env` list and silently losing the rest.

## Releases

A **release** is one installation of a chart into a cluster, tracked by name. Helm stores release state as Secrets in the release namespace, which is what makes upgrades and rollbacks possible.

```bash
helm install api ./mychart -n prod
helm upgrade api ./mychart -n prod --atomic --timeout 5m
helm list -n prod
helm history api -n prod
helm rollback api 3 -n prod
helm uninstall api -n prod
```

`--atomic` is worth defaulting to: if the upgrade fails or times out, Helm automatically rolls back to the previous revision instead of leaving a half-applied mess. Pair it with `--timeout`, since without one it waits on the default.

`helm history` shows the revision list, and `helm rollback` targets any of them — same instant-revert property as the ReplicaSet history behind a Deployment ([Core Objects](/blog/k8s-core-objects)).

## Helm 4 — the current version

Worth being current on: **Helm 4 went GA in November 2025**, the first major version in six years, and Helm 3 is now winding down — its final feature release is scheduled for September 2026, with security patches ending February 2027.

The migration points that matter:

- **Existing charts keep working.** Helm 3 (v2-format) charts run unmodified on Helm 4. A new v3 chart format is planned but not shipped yet.
- **New releases use server-side apply**; releases migrated from Helm 3 stay on client-side apply. That's a real behavioral difference between a fresh install and an upgraded one.
- **`--post-renderer` no longer accepts an arbitrary executable** — it takes a plugin name now, which breaks pipelines that piped through a script.
- Some flag behavior changed around `--atomic` / `--force` and registry login paths.

If you're on Helm 3 today, nothing is on fire — but pipelines pinning `helm` from a container image should be planning the bump rather than discovering it in February 2027.

## Helm vs Kustomize

Different philosophies, and both are legitimate:

**Helm** templates with a values file, and packages the result as a distributable, versioned artifact. Best when you're **publishing** something for others to install, or consuming third-party charts (which is most of the ecosystem — ingress controllers, operators, databases all ship as charts).

**Kustomize** does no templating at all: a base of plain manifests plus overlay patches per environment. It's built into `kubectl` (`kubectl apply -k`). Best when you're managing **your own** manifests and want to read plain YAML rather than Go templates.

They're not mutually exclusive — Kustomize can post-process Helm output, and ArgoCD/Flux render both natively ([Deployment Strategies](/blog/k8s-deployment-strategies)).

## On EKS and AKS

Helm is a client-side tool — it renders templates and talks to the API server, so it behaves identically on both. Where the clouds intersect with it:

- Most cluster add-ons install as charts on both: the AWS Load Balancer Controller, Karpenter, cert-manager, external-dns, Prometheus stacks.
- Both clouds increasingly offer **managed add-ons** as an alternative to Helm-installing the same components — EKS add-ons (including the community catalog covering metrics-server, cert-manager, external-dns) and AKS add-ons/extensions. The trade-off is the same either way: managed means the cloud patches it and validates version compatibility, Helm means you control the version and values precisely. See [CI/CD and Add-ons on EKS](/blog/eks-cicd-addons).
- Chart repositories are increasingly **OCI registries** rather than the old HTTP index format — ECR and ACR both host OCI charts, so charts live alongside container images in the same registry.

---

*Next:* [Service Mesh: Istio, Envoy, and Traffic Management](/blog/k8s-service-mesh)
