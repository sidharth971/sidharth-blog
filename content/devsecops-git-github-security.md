---
title: "Securing Git and GitHub: From .gitignore to Branch Protection"
slug: devsecops-git-github-security
category: DevSecOps
subcategory: Git
tags: devsecops, git, github, security, gitleaks, dependabot, codeowners
excerpt: A layered defense for a Git repo — prevent secrets from being committed, catch what slips through, enforce it in CI instead of trusting local hooks, then govern who can merge what. Plus signed commits, CodeQL, 2FA, and scoped tokens.
status: published
---

None of these controls work in isolation — that's the actual point of this post. A `.gitignore` stops the obvious case; a pre-commit hook stops a bit more, but only on machines that have it installed and only until someone runs `--no-verify`; a CI check stops it regardless of what's installed locally, but only for new commits, not the secret that's already sat in history for eight months. Real Git/GitHub security is these layers stacked, not any single one of them.

## 1. `.gitignore` — the first, weakest layer

Everyone knows what it's for; the part that trips people up is what it *doesn't* do: `.gitignore` only stops **untracked** files from being added. If a file is already committed, adding it to `.gitignore` does nothing — it stays in history forever until it's explicitly removed (`git rm --cached`) and, if it ever held a real secret, the history rewritten or the secret rotated. Treat `.gitignore` as preventing a mistake, not fixing one that already happened.

Start from GitHub's own maintained templates (`github/gitignore`) for your stack rather than hand-rolling one — `.env`, `.env.local`, `*.pem`, `*.key`, `terraform.tfstate`, and IDE/OS cruft (`.DS_Store`, `.vscode/`) are the recurring offenders worth double-checking are actually covered.

## 2. Native Git pre-commit hooks

Git has always supported local hooks — a script at `.git/hooks/pre-commit` runs before a commit is created, and a non-zero exit code blocks it. The catch: `.git/hooks/` is **not** version-controlled by Git itself, so a hook you write doesn't automatically exist on a teammate's clone. Two common ways around that:

- **`pre-commit` framework** — a `.pre-commit-config.yaml` checked into the repo, installed once per clone (`pre-commit install`), runs a defined set of hooks (linters, formatters, secret scanners) consistently across every contributor's machine.
- **Husky** (Node ecosystem) — same idea, wired through `package.json` and `npm install`, so the hook installs automatically as part of the normal setup flow.

Either way, the goal is the same: stop relying on "remember to run the check yourself" and make the hook part of getting the repo working at all.

## 3. Block commits with Gitleaks

[Gitleaks](https://github.com/gitleaks/gitleaks) is the standard open-source secret scanner — regex + entropy-based detection for AWS keys, private keys, API tokens, and a large maintained library of provider-specific patterns. Wired into a pre-commit hook via `gitleaks protect --staged`, it scans only what's about to be committed and blocks the commit outright if it finds something:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.21.2
    hooks:
      - id: gitleaks
```

This is the same category of mistake this very series has run into more than once — a database password, a GitHub token, both pasted in plaintext at some point — caught *before* it's committed instead of after.

## 4. Gitleaks — repository & history scanning

A pre-commit hook only ever sees the diff being committed *right now*. It says nothing about a secret that was committed six months ago, is still sitting in `git log`, and would still be exposed the instant the repo is made public or shared. `gitleaks detect` solves that different problem — a full scan of the repository and its entire commit history:

```bash
gitleaks detect --source . --report-path gitleaks-report.json
```

Run this once as a baseline on any repo that predates having secret scanning at all, not just going forward — the pre-commit hook only protects the future, this checks the past.

## 5. Gitleaks in GitHub Actions

A local hook is opt-in and trivially bypassed (`git commit --no-verify`, or simply not having run `pre-commit install`). It's a courtesy to contributors, not a control. The actual enforcement point is CI, where it can't be skipped by an individual's local setup:

```yaml
# .github/workflows/gitleaks.yml
name: gitleaks
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

`fetch-depth: 0` matters — a shallow checkout only has the latest commit, which defeats scanning history. Make this a **required status check** (see Branch Protection below) so a PR that fails it literally cannot be merged, regardless of what ran or didn't run on the author's laptop.

## 6. GitHub's native secret scanning + push protection

GitHub also does this natively, and it's worth knowing exactly where it applies before assuming it has you covered: **secret scanning and push protection are free for public repositories** (and on by default for them), but **private and internal repositories need GitHub Advanced Security — or GitHub's newer standalone "GitHub Secret Protection" product — both paid, billed per active committer**. That's the concrete reason Gitleaks stays relevant even with GitHub's own scanner in the picture: most real work happens in private repos, and Gitleaks is free and works on all of them regardless of plan. Where GHAS/Secret Protection *is* available, it adds something Gitleaks can't do server-side on its own — **push protection**, which rejects the `git push` itself at the API level before the commit ever lands on GitHub, not just after in a CI job.

## 7. Branch Protection Rules → Rulesets

The classic mechanism: per-branch settings requiring status checks to pass, requiring reviews, and blocking force-pushes or deletion before a merge is allowed. As of 2026, GitHub has been actively pushing a **migration path from classic Branch Protection Rules to Rulesets** — including a one-click automatic conversion tool shipped this year — because Rulesets apply across multiple branches by pattern, can be layered, and work at the organization level instead of being configured per-repository. Classic branch protection rules still work and are what most documentation still calls them by name, but for anything set up new, Rulesets are the current direction:

- Require status checks to pass (this is where the Gitleaks Action from #5 becomes a hard gate, not a suggestion).
- Require pull request review before merging.
- Restrict who can push directly, force-push, or delete the branch.
- Optionally require signed commits (see #12).

## 8. RBAC

GitHub layers two levels of role-based access: **organization roles** (owner, member, and more granular billing/security-manager roles) control org-wide administrative capability, and **repository roles** (read, triage, write, maintain, admin) control what a given person or team can do on a specific repo. Assign through **teams**, not individuals — a `platform-team` group with `write` on the infra repos scales and audits far better than remembering to add/remove five separate people every time someone joins or leaves. Same least-privilege instinct as the IAM scoping covered throughout the AWS/EKS series on this blog: grant the narrowest role that lets someone do their actual job, not the broadest one that's convenient.

## 9. Mandatory reviews

Part of branch protection/rulesets, worth calling out on its own since the specific settings matter: require a minimum number of approving reviews, and — the setting people forget — **dismiss stale approvals when new commits are pushed**, so an approval doesn't silently carry over to code nobody actually looked at after the last push. Combine with **"require review from Code Owners"** to make sure the *right* reviewer is the one whose approval counts, not just any reviewer.

## 10. CODEOWNERS

A `CODEOWNERS` file (repo root, `.github/`, or `docs/`) maps file paths to the people or teams required to review changes there:

```
# .github/CODEOWNERS
*                       @platform-team
/terraform/             @infra-team
/src/lib/supabaseClient.ts @backend-team
*.sql                   @database-team
```

Paired with "require review from Code Owners" from #9, this is what makes reviews actually targeted instead of generic — a change to `/terraform/` needs the infra team's eyes specifically, not just approval from whoever happened to be free.

## 11. Dependabot

Two distinct jobs under one name, worth not conflating:

- **Security updates** — automatic, driven by GitHub's advisory database. When a dependency you use gets a published CVE, Dependabot opens a PR bumping to the patched version. No config file needed to get this; it's on by default once Dependabot alerts are enabled.
- **Version updates** — routine, scheduled bumps to stay current even without a security advisory, configured explicitly via `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      dev-dependencies:
        dependency-type: "development"
      security-patches:
        applies-to: "security-updates"
        patterns: ["*"]
```

`groups` bundles related updates into one PR instead of twenty separate ones — a real quality-of-life feature once a project has any real dependency count. The easy-to-miss detail: a `groups` rule does **nothing** for security-update PRs unless it explicitly sets `applies-to: security-updates` — without it, your grouping only applies to routine version updates, and security fixes keep arriving as individual PRs regardless.

## 12. Signed commits

Git commits are trivially forgeable — the author name/email on a commit is just metadata, not proof of identity. **Commit signing** (GPG or, more simply now, SSH key signing) cryptographically ties a commit to a specific key, and GitHub shows a "Verified" badge when the signature checks out against a key registered to that account. Branch protection/rulesets can **require** signed commits on protected branches, turning "who actually made this commit" from an assumption into something verifiable — relevant the moment more than one person can push to a repo, not just for open-source projects with anonymous contributors.

## 13. Code scanning / CodeQL

A different problem from everything above: Gitleaks and GitHub secret scanning look for **leaked credentials**; CodeQL looks for **vulnerable code patterns** — SQL injection, XSS, insecure deserialization — via static analysis, run the same way as the Gitleaks Action, as a required GitHub Actions check:

```yaml
# .github/workflows/codeql.yml
- uses: github/codeql-action/init@v3
  with:
    languages: javascript-typescript
- uses: github/codeql-action/analyze@v3
```

Free for public repositories, part of GitHub Advanced Security for private ones — the same free-public/paid-private split as native secret scanning, for the same underlying reason (GHAS is the paid tier that unlocks GitHub's deeper security tooling on private repos).

## 14. Org-wide 2FA enforcement

The cheapest, highest-leverage control on this entire list, and the one most often skipped: GitHub organizations can **require two-factor authentication** for every member, with non-compliant accounts automatically removed from the org until they enable it. All the branch protection and CODEOWNERS rules in the world don't matter if an attacker can just log in as a maintainer because their password leaked somewhere unrelated. Org Settings → Authentication security → "Require two-factor authentication" — a five-minute change with a real security payoff.

## 15. Least-privilege tokens (fine-grained PATs)

Classic Personal Access Tokens are all-or-nothing — a classic PAT with `repo` scope can read and write *every* repository the account can access, private or public, org or personal. **Fine-grained PATs** scope a token to specific repositories and specific permissions (e.g. "contents: write" on exactly one repo, nothing else) with a mandatory expiration date. This isn't theoretical: a classic-scoped token pasted anywhere it shouldn't be — a chat log, a committed file, a CI log — is a credential to the account's entire footprint; a fine-grained token scoped to one repo limits the blast radius to that repo alone. Default to fine-grained tokens, and treat any token pasted in plaintext anywhere as compromised the moment it's pasted, regardless of scope — rotate it, don't just hope no one saw it.

## The layered picture

Prevention (`.gitignore`, pre-commit hooks) catches the easy cases cheaply. Detection (Gitleaks, native secret scanning) catches what prevention misses, both going forward and retroactively through history. CI enforcement (Gitleaks Action, CodeQL, required status checks) makes detection non-optional instead of a local courtesy. Governance (Rulesets, RBAC, mandatory reviews, CODEOWNERS) controls who can change what and who has to sign off. Signed commits, 2FA, and scoped tokens close the identity gaps underneath all of it. No single layer here is sufficient on its own — that's not a weakness of any individual tool, it's just what defense in depth actually looks like for a Git repo.
