---
title: "Infrastructure as Code Security: Checkov, Vault, and Policy as Code"
slug: devsecops-iac-security
category: DevSecOps
subcategory: IAC
tags: devsecops, iac, terraform, checkov, vault, security, policy-as-code
excerpt: Static analysis before apply (Checkov, the tfsec-to-Trivy move), why "we use Vault" doesn't automatically mean secrets are safe in Terraform state, and enforcing all of it — policy as code, least-privilege pipelines, pinned modules — in CI.
status: published
---

The [Git & GitHub security post](/blog/devsecops-git-github-security) on this blog covers protecting source code. Infrastructure as code needs the same layered thinking, but the failure mode is worse in one specific way: a misconfigured resource is one mistake, but a **misconfigured module** is every environment that module gets used in — dev, staging, and production all inheriting the same public S3 bucket or the same overly-permissive security group, simultaneously, the moment someone runs `terraform apply`. Catching that at `plan` time, before it's live, is the entire point of everything below.

## 1. Why IaC security is a different problem

Traditional application security finds a vulnerability in *running* code. IaC security's job is to find the vulnerability **before anything runs** — a static analysis pass over `.tf` files, Kubernetes manifests, or CloudFormation templates that catches "this security group allows `0.0.0.0/0` on port 22" or "this S3 bucket has no encryption configured" at the pull-request stage, the same shift-left instinct as the Gitleaks/CodeQL checks from the Git security post, just aimed at infrastructure definitions instead of application code.

## 2. Checkov

[Checkov](https://www.checkov.io/) is the standard open-source static analyzer for IaC — it understands Terraform, CloudFormation, Kubernetes manifests, Dockerfiles, and several others, and ships with 1000+ built-in policies covering encryption, public access, IAM over-permissioning, logging/monitoring gaps, and provider-specific misconfigurations. Run locally against a Terraform directory:

```bash
checkov -d . --framework terraform
```

It's also extensible — custom policies (Python or a YAML-based rule format) let a team encode its *own* rules on top of the built-in set: "every S3 bucket must have the `DataClassification` tag," "no security group may allow inbound `0.0.0.0/0`," things generic checks can't know are important to your org specifically.

## 3. Checkov in pre-commit and CI

Same two-layer pattern as Gitleaks from the Git security post: a local hook gives fast feedback before a commit even happens, but the actual enforcement point is CI, since a local hook is opt-in and skippable.

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/bridgecrewio/checkov
    rev: '3.2.334'
    hooks:
      - id: checkov
```

```yaml
# .github/workflows/checkov.yml
- uses: bridgecrewio/checkov-action@master
  with:
    directory: .
    framework: terraform
    soft_fail: false
```

`soft_fail: false` is the setting that matters — without it, Checkov reports findings but doesn't actually fail the build, which quietly turns a security gate into a suggestion nobody's required to act on.

## 4. tfsec → Trivy

If you've seen `tfsec` recommended elsewhere, know that it's effectively deprecated: Aqua Security merged all of its checks into **Trivy** back in 2024, and `tfsec`'s last release was May 2025 with no new rules since. The checks still work, but nothing new is being added. For new setups, go straight to Trivy's config scanner instead:

```bash
trivy config .
```

This is the same Trivy already covered in this blog's [EKS Security & Compliance post](/blog/eks-security-compliance) for container image scanning — one tool doing both jobs (IaC misconfiguration + image vulnerabilities + Kubernetes manifests + SBOM generation) is a real reason to standardize on it over running Checkov and a separate image scanner as two disconnected tools, even though Checkov's custom-policy ecosystem is still worth keeping alongside it for org-specific rules.

## 5. HashiCorp Vault

Where Checkov and Trivy stop secrets from being *misconfigured*, Vault stops them from being *hardcoded* in the first place. Vault is centralized secrets management — instead of a database password sitting in a `terraform.tfvars` file or a Kubernetes Secret someone created by hand, it lives in Vault and gets fetched at the moment it's actually needed.

The more important distinction is **dynamic vs. static secrets**:
- **Static secrets** — Vault stores a value (an API key, a password) and hands it back on request. Better than a value sitting in a config file, but it's still the same long-lived credential every time.
- **Dynamic secrets** — Vault *generates* a credential on demand (a scoped database user, temporary AWS IAM credentials) with a built-in TTL, and automatically revokes it on expiry. Nobody has to remember to rotate it, and a leaked dynamic secret is only useful for as long as its TTL — minutes to hours, not indefinitely.

Applications and pipelines authenticate to Vault and pull what they need via **Vault Agent** (which handles the fetch-and-inject and can auto-renew leases) rather than a human copying a value into an environment variable by hand.

## 6. Vault + Terraform — the gotcha "we use Vault" doesn't fix

This is the sharpest point in this whole post: **pulling a secret from Vault into Terraform does not make it safe.** The moment a Vault secret is read via a `vault_generic_secret` data source (or similar) and used anywhere in a Terraform config, its value gets written into `terraform.tfstate` — in plaintext, exactly like every other resource attribute Terraform tracks. Using Vault as the *source* of the secret doesn't change what Terraform does with it once it has it.

```hcl
# This value now lives in terraform.tfstate, plaintext, regardless of
# the fact that it came from Vault instead of a hardcoded string.
data "vault_generic_secret" "db" {
  path = "secret/data/db-credentials"
}

resource "aws_db_instance" "main" {
  password = data.vault_generic_secret.db.data["password"]
}
```

The actual mitigations, stacked:
- **Prefer dynamic secrets** wherever the provider supports it, specifically *because* a leaked state file's credential expires quickly instead of being valid indefinitely — this is the single biggest lever here.
- **Dynamic provider credentials** for Terraform's own authentication *to* Vault (and to cloud providers generally) instead of a long-lived static token, narrowing the blast radius of the CI pipeline's own credentials too.
- Treat state encryption and access restriction (next section) as mandatory, not optional, the instant any secret — Vault-sourced or not — touches a Terraform config.

## 7. Terraform state file security

The [Terraform series' Day 4 post](/blog/terraform-day-04-state-file-remote-backend) on this blog covers the mechanics of a remote S3 backend with native state locking; the security framing on top of that mechanics: state must be **encrypted at rest** (`encrypt = true` in the backend block), the S3 bucket restricted to the specific IAM roles that actually run Terraform (not readable by every engineer with general AWS console access), and **never** a local `terraform.tfstate` file when anything secret-adjacent is in play — a local state file is unencrypted-by-default, un-access-controlled, and routinely ends up accidentally committed by someone who forgot it wasn't in `.gitignore`.

## 8. Policy as code: OPA vs. Sentinel

Checkov and Trivy catch *known* misconfiguration patterns. **Policy as code** is for enforcing rules that are specific to your organization and don't exist in any generic ruleset — "production resources must be tagged with a cost center," "only these three instance types are approved," "this module can never be used outside the `networking` team's directory." HCP Terraform (and Terraform Enterprise) support two frameworks for this, and they solve the same problem differently:

- **Sentinel** — HashiCorp's own policy language, tightly integrated with HCP Terraform/Enterprise workflows specifically, including the ability to evaluate against plan data, state, and even cost estimates before an apply is allowed to proceed.
- **OPA (Open Policy Agent) / Rego** — vendor-neutral; the same policy engine and largely the same policies can govern Terraform, OpenTofu, Kubernetes admission control (as covered in the [EKS Security & Compliance post](/blog/eks-security-compliance)), and CI pipelines, instead of a Terraform-specific tool.

If the org is committed to HCP Terraform/Enterprise specifically, Sentinel is the natural fit and requires no separate tooling. If policy consistency across more than just Terraform matters — the same rules governing Kubernetes and CI, not just infrastructure provisioning — OPA is the more defensible choice, at the cost of more setup and policy-writing discipline up front. Both can run side by side in the same HCP Terraform workspace; picking one doesn't have to mean permanently ruling out the other.

## 9. Enforcing it all in CI/CD

None of the above matters if it's advisory. The pattern from the Git security post applies again directly: Checkov/Trivy and any policy-as-code checks become **required status checks** on the branch protection ruleset guarding the branch that triggers `apply` — a PR that fails a security scan or a policy check simply cannot merge, the same non-optional gate as the Gitleaks Action from that post.

## 10. Least-privilege CI/CD credentials

The credentials the pipeline itself uses to run `terraform apply` deserve the same least-privilege treatment as any human's IAM policy — a running theme throughout the AWS/EKS series on this blog. A CI role with account-admin permissions "to keep things simple" means a compromised pipeline (a malicious PR from a fork, a poisoned dependency, a leaked CI token) has account-admin blast radius. Scope the apply role to exactly the resource types and actions the infrastructure it manages actually needs, nothing broader.

## 11. Secure module sourcing

A `module` block pulling from an unpinned Git ref (`?ref=main`) means the exact code that runs on the next `apply` can change without anyone touching this repo at all — whatever the module's `main` branch happens to contain at that moment, trusted implicitly. Pin to a specific tag or commit SHA instead:

```hcl
module "vpc" {
  source = "git::https://github.com/org/terraform-aws-vpc.git?ref=v3.2.1"
}
```

Same supply-chain instinct as pinning a GitHub Action to a SHA instead of a floating tag, or a Docker base image to a digest instead of `:latest` — a version you didn't explicitly review shouldn't be able to silently become what's running.

## Closing the loop

Static analysis (Checkov, Trivy) catches known-bad patterns before apply. Vault removes hardcoded secrets — with the state-file caveat in mind, not as a silver bullet. Policy as code enforces the rules that are specific to your org. CI enforcement makes all of it non-optional. And none of this replaces watching for drift after the fact — the [Terraform series' final post](/blog/terraform-day-30-drift-detection-auto-remediation) covers catching infrastructure that's changed outside Terraform entirely, which is a different problem again from anything a pre-apply scan can catch.
