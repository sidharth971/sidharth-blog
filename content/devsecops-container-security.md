---
title: "Securing Containers: From Insecure Defaults to a Hardened Runtime"
slug: devsecops-container-security
category: DevSecOps
subcategory: Containers
tags: devsecops, containers, docker, security, distroless, supply-chain
excerpt: A progressive walkthrough from a deliberately insecure Dockerfile to a hardened one — non-root users, .dockerignore, multi-stage builds, distroless (and the :nonroot tag people miss), runtime flags, build-time secrets, SBOMs and signing, and how every hardening flag maps onto a Kubernetes securityContext.
status: published
---

A container is not a security boundary by default. It's a process on the host kernel with some namespaces around it — and if that process runs as root, has every Linux capability, can write anywhere on its filesystem, and was built from an image containing your `.git` directory and a shell, then "it's containerized" buys you very little.

This post walks the same path I'd take with a real service: start from the insecure default almost every tutorial produces, then fix one thing at a time, verifying each step. Every stage below is a working Dockerfile you can build. The second half covers the parts that don't fit into a single Dockerfile — build-time secrets, scanning, signing, host-level isolation — and finishes by mapping every `docker run` hardening flag onto its Kubernetes `securityContext` equivalent, since that's where most of these images actually end up.

## 1. The insecure baseline

Here's the Dockerfile most projects start with. It works, it ships, and it's wrong in about five different ways:

```dockerfile
FROM node:24

WORKDIR /app
COPY . .
RUN npm install

EXPOSE 3000
CMD ["node", "server.js"]
```

Build and inspect what you actually produced:

```bash
docker build -t myapp:insecure .
docker run --rm myapp:insecure id
# uid=0(root) gid=0(root) groups=0(root)
```

The problems, in order of how much they matter:

- **Runs as root.** Nothing in the Dockerfile said `USER`, and the `node` base image leaves the default at UID 0. Anything that escapes the process — a deserialization bug, a path traversal, a vulnerable dependency — is root inside the container, and root inside the container is one misconfiguration away from root on the host.
- **`COPY . .` copies everything.** Your `.git` history, `.env` file, CI config, local `node_modules`, and any credentials sitting in the working directory are now baked into an image layer.
- **Build toolchain ships to production.** `npm install` pulls compilers, headers, and dev dependencies into the same image you deploy.
- **Full OS underneath.** `node:24` is Debian with a shell, a package manager, `curl`, and hundreds of packages you never call — every one of them a CVE surface and a tool an attacker can use once they're inside.
- **Writable filesystem, no limits.** The process can write anywhere, fork without bound, and consume all available memory.

Each of the next five sections removes one of those.

## 2. Run as a non-root user

The single highest-value change, and a two-line one:

```dockerfile
FROM node:24

RUN groupadd -g 10001 appuser \
 && useradd -u 10001 -g appuser -m -s /usr/sbin/nologin appuser

WORKDIR /app
COPY --chown=appuser:appuser . .
RUN npm install

USER appuser

EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t myapp:nonroot -f Dockerfile.nonroot .
docker run --rm myapp:nonroot id
# uid=10001(appuser) gid=10001(appuser) groups=10001(appuser)
```

Two details worth being deliberate about:

**Assign an explicit numeric UID.** A common version of this snippet uses `useradd -r`, which creates a *system* account — and system accounts get a UID **below 1000** (typically somewhere in 100–999), assigned by whatever's free on that base image. So the UID varies between builds and base image versions, and it won't be the 1000 you might expect. That matters because Kubernetes `runAsUser` and `runAsNonRoot` checks work on **numeric UIDs**, not names — the kubelet has no idea what "appuser" means. Pin it with `-u 10001` and the number is stable everywhere. (Values above 10000 also stay clear of host UIDs that already exist, which keeps user-namespace remapping tidy.)

**The one-line version.** The official `node` images already ship a `node` user at UID 1000, so `USER node` alone gets you most of the way. Creating your own user is worth it when you want a UID you chose rather than one the base image chose.

**`COPY --chown`** matters because files copied in are owned by root by default. Without it, your non-root process may be unable to write where it needs to — and, more subtly, `npm install` running before `USER` still executes as root, which is fine for installing but means the resulting `node_modules` is root-owned.

What this buys you: a container escape now starts from an unprivileged account. It doesn't make escape impossible, it makes it a two-step problem instead of a one-step one — and most real-world container escapes depend on starting as root.

## 3. `.dockerignore`

`COPY . .` copies the build context. `.dockerignore` is what controls the build context. Without one, this is what ends up in your image:

```bash
docker run --rm myapp:insecure ls -a /app
# .git  .env  .github  node_modules  Dockerfile  src  ...
```

A `.env` in an image layer is a leaked credential, full stop — anyone who can pull the image can read it, and `docker history` will happily show them where it came from. A `.git` directory is worse than it looks: it contains **every version of every file ever committed**, so secrets you removed in a later commit are still right there.

```
.git
.gitignore
.env
.env.*
*.pem
*.key
node_modules
npm-debug.log
Dockerfile*
.dockerignore
.github
.vscode
coverage
dist
README.md
```

Verify it's working before you trust it:

```bash
docker build -t myapp:ignored .
docker run --rm myapp:ignored ls -a /app
```

The secondary benefit is speed — a smaller context uploads faster to the daemon and invalidates the build cache less often. But the reason it's in a security post is the first one. This pairs directly with the secret-scanning layers in the [Git & GitHub security post](/blog/devsecops-git-github-security): `.gitignore` keeps secrets out of the repo, `.dockerignore` keeps them out of the image, and Gitleaks catches the times both were forgotten.

## 4. Multi-stage builds

Your build needs compilers, dev dependencies, and test tooling. Your runtime needs none of it. A multi-stage build separates the two and ships only the second:

```dockerfile
# ---------- build stage ----------
FROM node:24 AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:24-slim AS runtime

RUN groupadd -g 10001 appuser \
 && useradd -u 10001 -g appuser -m -s /usr/sbin/nologin appuser

WORKDIR /app
COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appuser /app/dist ./dist

USER appuser

EXPOSE 3000
CMD ["node", "dist/server.js"]
```

```bash
docker images myapp
# myapp   insecure   1.42GB
# myapp   multi      210MB
```

The security argument is not really about size — it's that **only the final stage's layers exist in the shipped image**. Anything in the builder stage (source code, `.git` if it slipped through, build-time credentials, dev dependencies with their own CVEs) is discarded. `npm ci` over `npm install` matters here too: it installs exactly what the lockfile pins, so the build is reproducible and a transitive dependency can't quietly change version between builds.

Note also the `COPY package*.json ./` before `COPY . .` — that's layer-cache ordering, so a source change doesn't reinstall every dependency. Not a security property, but it's why the stages are split this way.

## 5. Distroless — and the tag almost everyone gets wrong

`node:24-slim` still contains a shell, a package manager, and a userland. **Distroless** images contain your application, its runtime, CA certificates, and essentially nothing else — no `sh`, no `bash`, no `apt`, no `curl`, no `ls`.

```dockerfile
# ---------- build stage ----------
FROM node:24 AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- runtime stage ----------
FROM gcr.io/distroless/nodejs24-debian13:nonroot

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["dist/server.js"]
```

Three things to notice.

**The `:nonroot` tag is not optional.** This is the mistake I see most often, and it silently undoes section 2. The plain `gcr.io/distroless/nodejs24-debian13` tag **runs as root (UID 0)**. Only the `:nonroot` variant sets UID **65532**. So a Dockerfile that carefully creates a UID 10001 user in an earlier iteration, then switches its runtime stage to plain distroless, has quietly gone back to running as root — while looking more hardened than before. Check it, don't assume:

```bash
docker build -t myapp:distroless .
docker inspect myapp:distroless --format '{{.Config.User}}'
# 65532:65532
```

You can't `docker run --rm myapp:distroless id` to verify — there's no `id` binary, which is rather the point. `docker inspect` is how you check, or `kubectl exec` won't help you either; use `runAsUser` enforcement in Kubernetes instead (section 14).

**Match the runtime major version to the builder.** `node:24` building against `distroless/nodejs24` — not `nodejs20` against a `node:25` builder. Native modules compiled with one Node ABI can fail at runtime on another, and version-skew bugs like that surface as mysterious crashes long after the build succeeded. Also keep the base current: the Debian 12–based distroless Node tags are superseded by Debian 13 ones (`nodejs22`, `nodejs24`, `nodejs26-debian13`).

**`CMD` has no shell.** Distroless Node images set `node` as the entrypoint, so `CMD` is just arguments — `CMD ["dist/server.js"]`, not `CMD ["node", "dist/server.js"]`. More generally, every distroless image requires **exec form** (`CMD ["a", "b"]`); shell form (`CMD node dist/server.js`) fails, because there's no shell to run it.

The real trade-off is debugging. You cannot shell into a distroless container — deliberately, since neither can an attacker who lands RCE with no shell to spawn. In Kubernetes the answer is **ephemeral debug containers**, which attach a fully-equipped container to the running Pod's namespaces without changing the image:

```bash
kubectl debug -it mypod --image=busybox:1.37 --target=app
```

Google also publishes `:debug` variants of every distroless image that include BusyBox — useful in a pinch, but they should never be what you deploy. If distroless is too austere for your team, **Chainguard Images** / Wolfi are a middle ground: minimal, near-zero-CVE, but with a package manager available in the dev variants.

## 6. Runtime hardening flags

Everything so far hardened the image. These harden the *container* — and they're free, in the sense that they cost nothing but a flag:

```bash
docker run -d \
  --name myapp \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --pids-limit 200 \
  --memory 512m --memory-swap 512m \
  --cpus 1.0 \
  -p 3000:3000 \
  myapp:distroless
```

| Flag | What it prevents |
| --- | --- |
| `--read-only` | Writing a webshell, dropping a binary, tampering with config at runtime |
| `--tmpfs /tmp` | Gives back the one writable path most apps need, with `noexec` so nothing dropped there can be run |
| `--cap-drop ALL` | Removes all Linux capabilities — no raw sockets, no mount, no `CAP_SYS_ADMIN` |
| `--security-opt no-new-privileges` | Blocks privilege escalation via setuid binaries, even if one exists |
| `--pids-limit` | Contains fork bombs and runaway process spawning |
| `--memory` / `--cpus` | Stops one container starving the host and its neighbours |

`--cap-drop ALL` is worth stressing. A default Docker container gets around 14 capabilities it almost certainly doesn't need. Drop everything, then add back only what genuinely fails — and if the answer is `NET_BIND_SERVICE` because the app listens on port 80, the better fix is to listen on 8080 and map the port, rather than granting the capability at all.

Two flags that are the *inverse* of hardening and deserve naming: `--privileged` disables essentially all of this at once and is very close to giving the container the host, and `--pid=host` / `--net=host` remove the namespaces that make it a container. If a tutorial tells you to add `--privileged` to fix a permissions error, that's a signal to find the specific capability actually needed, not to take the shortcut.

---

That's the progression through the Dockerfile. The rest is what a hardened image alone doesn't cover.

## 7. Pin base images by digest

`FROM node:24` is a **floating tag**. The image it resolves to today is not the image it resolves to next month — which is usually good (you get patches) and occasionally very bad (you get a change you didn't review, or a compromised tag). For anything that ships to production, pin the digest:

```dockerfile
FROM node:24.9.0-bookworm@sha256:a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90 AS builder
```

A digest is content-addressed: that exact bytes-on-disk image, forever. Two builds a year apart produce the same base layer, and a `docker build` cannot silently pull something different.

The obvious objection is that pinning means you stop getting security patches — which is true, and the answer is to make updating the pin an automated pull request rather than an implicit background event. Dependabot and Renovate both understand Docker digests and will open a PR when the tag moves, so the update goes through review, CI, and scanning like any other change. That's the same instinct as pinning GitHub Actions to a SHA or Terraform modules to a tag ([IaC security](/blog/devsecops-iac-security)) — a version you didn't review shouldn't be able to become what's running.

## 8. Build-time secrets: `ARG` is not a secret mechanism

This is the highest-severity mistake that still shows up regularly:

```dockerfile
# DO NOT DO THIS
ARG NPM_TOKEN
RUN echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc \
 && npm ci \
 && rm .npmrc
```

The `rm` does nothing for security. Image layers are **immutable and additive** — deleting a file in a later layer hides it from the final filesystem but leaves it fully readable in the layer that created it. Anyone with the image can recover it:

```bash
docker history --no-trunc myapp:leaky      # ARG values visible in build args
docker save myapp:leaky | tar -x           # every layer, including the deleted .npmrc
```

`ENV` is worse still — it persists into the running container's environment and shows up in `docker inspect`.

The correct mechanism is **BuildKit secret mounts**, which expose the secret to a single `RUN` and never write it to a layer:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:24 AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc,required=true \
    npm ci
```

```bash
docker build --secret id=npmrc,src=$HOME/.npmrc -t myapp:build .
```

The file exists only for the duration of that `RUN`, in a tmpfs mount, and appears in no layer and no `docker history`. There's also `--mount=type=ssh` for the same problem with private Git dependencies.

If a secret has already shipped in an image: rotate it. Rebuilding without it doesn't help anyone who already pulled the old tag — exactly the same reasoning as rotating a key that was committed to Git, since rewriting history doesn't un-leak it either.

## 9. Scan images for known vulnerabilities

Every image you build inherits the CVEs of its base and its dependencies. Scanning is how you find out before an attacker does:

```bash
# Trivy — OS packages + language dependencies + secrets
trivy image --severity HIGH,CRITICAL --ignore-unfixed myapp:distroless

# Fail the build on findings
trivy image --exit-code 1 --severity CRITICAL myapp:distroless

# Alternatives
grype myapp:distroless
docker scout cves myapp:distroless
```

`--ignore-unfixed` is the flag that makes scanning survivable in practice: without it you get a wall of CVEs with no available patch, teams start ignoring the output entirely, and the scan stops functioning as a gate. Filter to what you can actually act on.

Scanning belongs in two places — as a **required status check** on the pull request, and on a schedule against images already deployed, since a CVE published tomorrow affects an image built today without anything changing in the repo.

Trivy is covered in more depth in the [IaC security post](/blog/devsecops-iac-security) (where it also scans Terraform) and in [EKS Security and Compliance](/blog/eks-security-compliance) (alongside ECR's built-in scanning), so I won't repeat it here. The one container-specific note: this is where distroless pays off measurably — fewer packages means dramatically fewer findings, and the findings that remain are far more likely to be about code you actually run.

## 10. SBOM, provenance, and signing

Scanning tells you what's wrong with an image. The supply-chain layer answers a different question: **is this image what we think it is, built by us, from what we think?**

**SBOM** — a machine-readable inventory of everything in the image:

```bash
docker buildx build --sbom=true --provenance=mode=max -t myapp:1.0 --push .
syft myapp:1.0 -o spdx-json > sbom.json
```

An SBOM is what lets you answer "are we affected?" in minutes rather than days when the next Log4Shell lands — you query stored SBOMs instead of rebuilding and rescanning everything.

**Provenance** (SLSA attestations) records how the image was built: which source commit, which builder, which parameters. `--provenance=mode=max` on buildx emits it.

**Signing** with Cosign proves the image came from your pipeline:

```bash
# Keyless signing — identity from the CI OIDC token, logged to Rekor
cosign sign --yes myapp:1.0

cosign verify myapp:1.0 \
  --certificate-identity-regexp 'https://github.com/myorg/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Keyless is the mode worth adopting: no long-lived signing key to store or leak, identity bound to your CI's OIDC token, signature recorded in the public Rekor transparency log.

Signing is only useful if something **verifies**. In Kubernetes that's an admission policy — Kyverno's `verifyImages` rule or the Sigstore policy controller — rejecting any Pod whose image isn't signed by your pipeline's identity. That's an admission webhook doing the enforcement ([Extending Kubernetes](/blog/k8s-extensibility)), and it's what turns signing from a checkbox into an actual control: an attacker who pushes a malicious image to your registry still can't get it scheduled.

## 11. Never mount the Docker socket

```bash
# This is root on the host, with extra steps
docker run -v /var/run/docker.sock:/var/run/docker.sock myapp
```

A container with the Docker socket can ask the daemon — which runs as root on the host — to start a new container with `--privileged` and the host filesystem mounted. There is no meaningful boundary left. This isn't a hardening subtlety; it's the most common self-inflicted container escape, and it usually arrives via a CI runner or a monitoring agent that "needs Docker access."

The alternatives, in rough order of preference:

- **Rootless build tooling** — Kaniko, Buildah, or `buildkitd` in rootless mode build images without a privileged daemon at all.
- **A socket proxy** — `tecnativa/docker-socket-proxy` in front of the socket, allowing only the specific read-only endpoints a monitoring agent needs.
- **Read-only mount** (`:ro`) — better than nothing and a real reduction for read-only consumers, but note it does not fully contain a determined attacker.

The same rule applies to `/var/run/containerd/containerd.sock` and to hostPath mounts of `/` or `/proc` in Kubernetes.

## 12. Rootless Docker and user namespaces

Section 2's `USER` directive is about who your process is *inside* the container. This is about who it is on the **host** — and they're not the same question.

By default, container UID 0 **is** host UID 0. The namespaces stop it from acting like root on the host in most ways, but a kernel bug or a bad mount collapses that distinction immediately.

Two ways to break the mapping:

- **Rootless Docker / Podman** — the daemon itself runs as an unprivileged user, so there's no root daemon to compromise. Podman is rootless by default; Docker supports it via `dockerd-rootless-setuptool.sh`.
- **`userns-remap`** — the daemon stays root, but container UIDs are shifted into an unprivileged host range, so container root maps to something like host UID 231072.

```bash
# /etc/docker/daemon.json
{ "userns-remap": "default" }
```

Kubernetes has the same feature: **user namespaces for Pods** via `hostUsers: false`, which reached beta in 1.30 and is enabled by default in recent versions, though it needs runtime and kernel support (containerd 2.0+ / CRI-O with idmap mounts).

The layering is the point: `USER` means you're not root in the container; user namespaces mean that even if you were, you're still not root on the host.

## 13. seccomp and AppArmor

Capabilities control *what privileged operations* a process may perform. **seccomp** controls *which syscalls* it can make at all — a much finer filter, and it's how you shrink kernel attack surface rather than just permission surface.

Docker applies a default seccomp profile that blocks roughly 44 syscalls; the vast majority of applications never notice. `--security-opt seccomp=unconfined` removes it, and appears in far too many tutorials as a fix for a permissions error — it's the seccomp equivalent of `--privileged`.

```bash
docker run --security-opt seccomp=./profiles/myapp.json myapp:distroless
```

In Kubernetes, `RuntimeDefault` should be your baseline — and unlike Docker, Kubernetes historically defaulted to *unconfined* unless you asked:

```yaml
securityContext:
  seccompProfile:
    type: RuntimeDefault
```

**AppArmor** (Debian/Ubuntu) and **SELinux** (RHEL family) are mandatory access control on top: they restrict file paths, capabilities, and network operations per-profile. Kubernetes has had a first-class `appArmorProfile` field since 1.30 rather than the old annotation:

```yaml
securityContext:
  appArmorProfile:
    type: RuntimeDefault
```

Generating a *custom* tight seccomp profile is real work — the practical path is to make sure `RuntimeDefault` is on everywhere first, which is a one-line change and covers most of the value.

## 14. The Kubernetes bridge

Almost none of these images run under `docker run` in production. Here's every hardening flag above, translated:

| `docker run` flag | Kubernetes `securityContext` |
| --- | --- |
| `USER 10001` (Dockerfile) | `runAsUser: 10001`, `runAsGroup: 10001` |
| *(no equivalent)* | `runAsNonRoot: true` — kubelet refuses to start a container running as UID 0 |
| `--read-only` | `readOnlyRootFilesystem: true` |
| `--tmpfs /tmp` | An `emptyDir: {}` volume mounted at `/tmp` |
| `--cap-drop ALL` | `capabilities.drop: ["ALL"]` |
| `--security-opt no-new-privileges` | `allowPrivilegeEscalation: false` |
| `--security-opt seccomp=...` | `seccompProfile.type: RuntimeDefault` |
| `--memory` / `--cpus` | `resources.limits.memory` / `resources.limits.cpu` |
| `--pids-limit` | Kubelet's `podPidsLimit` (node-level, not per-Pod) |
| `--privileged` | `privileged: true` — the thing to forbid |

Put together:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: app
          image: myregistry/myapp@sha256:a1b2c3...
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              memory: 512Mi
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

A few notes on that manifest. `runAsNonRoot: true` is the belt-and-braces check that catches exactly the distroless-tag mistake from section 5 — the Pod fails to start rather than quietly running as root, which is precisely the failure mode you want. `fsGroup` sets group ownership on mounted volumes so a non-root process can write to them. And the memory limit without a CPU limit is deliberate: CPU limits cause throttling, and for most workloads a CPU *request* with no limit behaves better — the reasoning is in [Resource Management](/blog/k8s-resource-management).

Enforcing this across a cluster rather than hoping every team writes it is what **Pod Security Admission** is for — labelling a namespace `pod-security.kubernetes.io/enforce: restricted` rejects Pods that don't meet most of the above. For rules PSA doesn't cover, **ValidatingAdmissionPolicy** (CEL, in-tree, GA since 1.30) or Kyverno handle the rest. Both are covered in [Kubernetes Security & RBAC](/blog/k8s-security-rbac) and [Extending Kubernetes](/blog/k8s-extensibility).

## Where the layers land

The honest summary of everything above:

| Layer | Control |
| --- | --- |
| **Build context** | `.dockerignore` — nothing secret enters the image |
| **Build** | Multi-stage, `npm ci`, BuildKit secret mounts, pinned digests |
| **Image** | Distroless `:nonroot`, explicit UID, no shell |
| **Supply chain** | Scan, SBOM, provenance, Cosign signing + admission-time verification |
| **Runtime** | Read-only FS, drop all caps, no-new-privileges, seccomp, resource limits |
| **Host** | Rootless daemon / userns-remap, never mount the Docker socket |

No single one of these is the answer. A distroless image running as root with the Docker socket mounted is less safe than a Debian image running as UID 10001 with everything dropped. The value is in the stack, and the useful property of that stack is that each layer assumes the ones beneath it will eventually fail.

If you're starting from a real, existing service and want an order to do this in: `.dockerignore` and a non-root `USER` first — they're an afternoon and they remove the two worst failure modes. Multi-stage and scanning next, because they're mechanical. Distroless, signing, and host-level isolation after that, once the easy wins are banked.

This sits alongside the other two posts in this series: [Git & GitHub security](/blog/devsecops-git-github-security) for protecting the source, and [IaC security](/blog/devsecops-iac-security) for the infrastructure that runs it. Same shift-left instinct in all three — catch it at the pull request, enforce it in CI, and make the secure path the default one rather than the one someone has to remember.
