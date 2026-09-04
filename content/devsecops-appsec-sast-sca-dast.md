---
title: "AppSec for Beginners: SAST, SCA, and DAST on a Deliberately Vulnerable App"
slug: devsecops-appsec-sast-sca-dast
category: DevSecOps
subcategory: AppSec
tags: devsecops, appsec, sast, sca, dast, bandit, semgrep, owasp-zap, pip-audit
excerpt: Build a vulnerable Flask app, then find its flaws three different ways — Bandit and SonarQube for the code, pip-audit for the dependencies, OWASP ZAP for the running app — and see exactly which class of bug each one can and cannot see.
status: published
---

Three families of scanner, three different blind spots. The fastest way to understand why you need all of them is to build one small application containing a representative bug from each category, point all three tools at it, and watch each tool miss things the others catch.

That's this post. Everything below was run before publishing, and the tool output shown is real output, not illustrative — which matters, because the most common way an AppSec lab goes wrong is that the "expected findings" don't match what the app actually contains.

## The three tools in one paragraph each

**SAST — Static Application Security Testing.** Reads source code without running it. Sees insecure *patterns*: string-concatenated SQL, `eval()` on user input, hardcoded credentials, weak hashes. Runs earliest — in your IDE, on every pull request — which makes it the cheapest place to catch things. Its weakness is that it can't tell whether a dangerous-looking line is actually reachable by an attacker, so it produces false positives.

**SCA — Software Composition Analysis.** Ignores your code entirely and inventories your *dependencies*, matching versions against known CVE databases. This is the one most people underestimate: the majority of the code shipping in a typical application was written by strangers, and perfect code on top of a vulnerable library is still a vulnerable application.

**DAST — Dynamic Application Security Testing.** Attacks a *running* application from the outside, with no source access, the way a real attacker would. Its findings are the most credible — a DAST hit is usually a demonstrated exploit, not a suspicion — but it only finds what it can reach, needs a deployed environment, and runs latest in the cycle when fixes are most expensive.

| | Source code | Dependencies | Running app | Finds | Runs |
| --- | --- | --- | --- | --- | --- |
| **SAST** | ✅ | ❌ | ❌ | Insecure patterns | Pre-commit / PR |
| **SCA** | ❌ | ✅ | ❌ | Known CVEs | PR + scheduled |
| **DAST** | ❌ | ❌ | ✅ | Exploitable behaviour | Staging / nightly |

The rows don't overlap much, and that's the entire argument. There's a fourth column nobody's tool covers: **business logic flaws**. No scanner knows that your `/refund` endpoint should check who owns the order. That's what code review and threat modelling are for.

## Step 1: The vulnerable application

Two rules for a lab app: every claimed finding must actually be in the code, and the app must actually run. Both are easy to get wrong.

```
vulnerable-app/
├── app.py
├── requirements.txt
├── seed_db.py
└── sonar-project.properties
```

```python
# app.py
from flask import Flask, request, jsonify
import sqlite3
import subprocess
import random
import hashlib

app = Flask(__name__)

DATABASE = "users.db"

# VULNERABLE: hardcoded secrets
app.config["SECRET_KEY"] = "sup3r-s3cr3t-flask-key-do-not-commit"
API_TOKEN = "AKIAIOSFODNN7EXAMPLE"


def get_db():
    return sqlite3.connect(DATABASE)


@app.route("/")
def home():
    return "User Management Service"


@app.route("/user")
def get_user():
    user_id = request.args.get("id")
    conn = get_db()
    cursor = conn.cursor()
    # VULNERABLE: SQL injection via string interpolation
    query = f"SELECT id, username FROM users WHERE id = '{user_id}'"
    cursor.execute(query)
    user = cursor.fetchone()
    conn.close()
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify({"id": user[0], "username": user[1]})


@app.route("/token")
def generate_token():
    # VULNERABLE: predictable randomness for a security token
    return jsonify({"token": str(random.random())})


@app.route("/hash")
def hash_password():
    pw = request.args.get("pw", "")
    # VULNERABLE: weak hash algorithm
    return jsonify({"hash": hashlib.md5(pw.encode()).hexdigest()})


@app.route("/admin/ping")
def admin_ping():
    host = request.args.get("host", "127.0.0.1")
    # VULNERABLE: command injection via shell=True
    out = subprocess.check_output(f"ping -c 1 {host}", shell=True)
    return jsonify({"output": out.decode(errors="ignore")})


@app.route("/admin/calc")
def admin_calculate():
    expr = request.args.get("expr")
    # VULNERABLE: arbitrary code execution
    return jsonify({"result": eval(expr)})


if __name__ == "__main__":
    # VULNERABLE: debug mode exposes the Werkzeug debugger
    app.run(host="0.0.0.0", port=5000, debug=True)
```

Seven distinct vulnerability classes, one per endpoint, so each tool's findings map to something specific.

### Dependencies — pinning the transitive set too

```text
# requirements.txt
flask==3.1.0
Werkzeug==3.1.3
requests==2.31.0
```

**`Werkzeug` is pinned explicitly, and that's not optional.** Pinning only `flask==3.1.0` lets pip resolve Werkzeug to whatever is newest, and Flask's own internals break against a Werkzeug it wasn't written for. You get `ImportError: cannot import name 'url_quote' from 'werkzeug.urls'` — an installation that succeeds and an application that won't start.

This is also the reason to avoid the very old pins that appear in a lot of AppSec tutorials. `flask==1.0` is genuinely vulnerable, but it **cannot run on any currently supported Python**: it does `from collections import MutableMapping`, which was removed in Python 3.10, and `from jinja2 import Markup`, removed in Jinja2 3.0. The lab dies at Step 5 with an `ImportError` that has nothing to do with security. The versions above are recent enough to run on Python 3.12–3.14 and old enough to carry real CVEs — which is the combination you want.

The general lesson generalises past this lab: a `requirements.txt` that pins direct dependencies but not transitive ones isn't reproducible. Use `pip-compile` (pip-tools), Poetry, or `uv` to generate a fully-pinned lock file — the same argument as pinning container base images by digest in the [container security post](/blog/devsecops-container-security).

```python
# seed_db.py
import sqlite3

conn = sqlite3.connect("users.db")
conn.execute("CREATE TABLE IF NOT EXISTS users "
             "(id INTEGER PRIMARY KEY, username TEXT, password TEXT)")
conn.execute("INSERT OR REPLACE INTO users VALUES (1, 'alice', 'alice123')")
conn.execute("INSERT OR REPLACE INTO users VALUES (2, 'bob', 'bob456')")
conn.commit()
```

```bash
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python seed_db.py
```

## Step 2: SAST with Bandit

Start with **Bandit** rather than SonarQube. It's Python-specific, installs in one command, needs no server, and its rule set is exactly the list of insecure patterns you'd want a Python SAST to know:

```bash
pip install bandit
bandit -r . -f screen
```

Real output against the app above:

```text
LOW     B404  L3   Consider possible security implications associated with the subprocess module.
LOW     B105  L12  Possible hardcoded password: 'sup3r-s3cr3t-flask-key-do-not-commit'
LOW     B105  L13  Possible hardcoded password: 'AKIAIOSFODNN7EXAMPLE'
MEDIUM  B608  L31  Possible SQL injection vector through string-based query construction.
LOW     B311  L43  Standard pseudo-random generators are not suitable for security purposes.
HIGH    B324  L50  Use of weak MD5 hash for security. Consider usedforsecurity=False
HIGH    B602  L57  subprocess call with shell=True identified, security issue.
MEDIUM  B307  L65  Use of possibly insecure function - consider using safer ast.literal_eval.
HIGH    B201  L70  A Flask app appears to be run with debug=True, which exposes the
                   Werkzeug debugger and allows the execution of arbitrary code.
MEDIUM  B104  L70  Possible binding to all interfaces.
```

Ten findings across every class planted. Note what SAST is good at here: it found the hardcoded AWS-shaped key and the `shell=True` **without running anything**, in under a second.

Bandit's rule IDs map to the standard Python vulnerability catalogue, and they're worth knowing because they're what you'll be suppressing and arguing about:

| ID | Pattern | Why it matters |
| --- | --- | --- |
| `B105`/`B106` | Hardcoded password or secret | Anyone with repo read access has the credential |
| `B307` | `eval()` | Turns text into live code — attacker gets your interpreter |
| `B301` | `pickle` on untrusted data | Deserialization runs code on load |
| `B506` | `yaml.load()` without `SafeLoader` | The YAML file can construct Python objects |
| `B602` | `subprocess(..., shell=True)` | Shell metacharacters in input become commands |
| `B608` | String-built SQL | Classic injection |
| `B324` | MD5/SHA1 for security | Collision-broken; cracked trivially |
| `B501` | `requests(..., verify=False)` | Silently accepts any TLS certificate |
| `B108`/`B306` | `tempfile.mktemp()` | Race between name generation and file creation |
| `B311` | `random` for tokens | Predictable — use `secrets` |
| `B201` | Flask `debug=True` | Werkzeug debugger is remote code execution |

### Suppressing findings honestly

`B104` ("binding to all interfaces") is the false-positive-shaped one — binding `0.0.0.0` inside a container is normal and correct. This is where SAST programs live or die: if the only way to get a green build is to ignore the whole report, the tool stops working. Suppress narrowly, with a reason:

```python
app.run(host="0.0.0.0", port=5000)  # nosec B104 - containerised, ALB terminates ingress
```

A blanket `# nosec` with no rule ID and no justification is how a codebase ends up with silent real bugs.

### Adding Semgrep

Bandit knows Python patterns. **Semgrep** is the cross-language complement, with a large community rule registry and the ability to write custom rules in a syntax that looks like the code you're matching:

```bash
pip install semgrep
semgrep --config=p/security-audit --config=p/secrets .
```

Custom rules are where it earns its place — encoding *your* organisation's rules ("never call this deprecated internal auth helper", "all handlers must use our sanitiser") is something no off-the-shelf ruleset can do.

## Step 3: SAST with SonarQube

SonarQube adds what a CLI scanner can't: a persistent dashboard, trend tracking over time, and **quality gates** that fail a pipeline on new issues. Its most valuable feature for a real team is the **"new code" gate** — don't fix 4,000 legacy findings, just don't add any more. That's what makes adoption survivable on an existing codebase.

```bash
docker run -d --name sonarqube -p 9000:9000 sonarqube:community
```

Note `sonarqube:community`, not `sonarqube:9.9-community`. **SonarQube 9.9 is past end of life**, and the product was reorganised: the free edition is now **SonarQube Community Build**, released monthly with no LTA, while "SonarQube Server" refers to the paid editions (current LTA: 2026.1). Pinning to `9.9-community` gets you an unmaintained image — an awkward thing to run a security scan from.

Open `http://localhost:9000` (first login `admin`/`admin`, which it forces you to change), then generate a token under **My Account → Security**.

```properties
# sonar-project.properties
sonar.projectKey=vulnerable-python-app
sonar.projectName=Vulnerable Python App
sonar.sources=.
sonar.python.version=3.12
sonar.exclusions=venv/**,**/*.db
```

```bash
docker run --rm \
  -v "$(pwd):/usr/src" \
  --network host \
  sonarsource/sonar-scanner-cli \
  -Dsonar.host.url=http://localhost:9000 \
  -Dsonar.token=<YOUR_TOKEN>
```

Use **`sonar.token`**, not `sonar.login` — `sonar.login`/`sonar.password` are deprecated and slated for removal, and you'll get a warning on every run. It also reads from the `SONAR_TOKEN` environment variable, which is what you want in CI so the token never appears in a command line or build log.

Running the scanner in Docker avoids installing the scanner locally. On macOS or Windows, `--network host` doesn't work the way it does on Linux — use `-Dsonar.host.url=http://host.docker.internal:9000` instead.

Expect SonarQube to find the SQL injection, the `eval`, the hardcoded secrets, and debug mode. Expect it to report **fewer** Python security issues than Bandit — Community Build's Python security rules are narrower, and deep taint analysis across function boundaries is a commercial-edition feature. Run both; they cost nothing together.

## Step 4: SCA with pip-audit

```bash
pip install pip-audit
pip-audit -r requirements.txt
```

```text
Found 8 known vulnerabilities in 3 packages
Name     Version  ID               Fix Versions
-------- -------- ---------------- ------------
flask    3.1.0    PYSEC-2026-1377  3.1.1
flask    3.1.0    PYSEC-2026-2151  3.1.3
werkzeug 3.1.3    PYSEC-2026-2046  3.1.4
werkzeug 3.1.3    PYSEC-2026-2044  3.1.5
werkzeug 3.1.3    PYSEC-2026-2320  3.1.6
requests 2.31.0   PYSEC-2026-1873  2.32.0
requests 2.31.0   PYSEC-2026-1872  2.32.4
requests 2.31.0   PYSEC-2026-2275  2.33.0
```

Eight vulnerabilities, and **Bandit found none of them** — they aren't in your code. That's the SCA case in one screen.

Two flags worth knowing:

```bash
pip-audit --fix -r requirements.txt   # upgrade to the fixed versions
pip-audit                             # audit the live environment, not the file
```

Bare `pip-audit` (no `-r`) audits the **installed environment**, which is strictly more honest: `requirements.txt` lists what you asked for, the environment contains what you actually got, including transitive dependencies you never named. Most real CVEs arrive through a dependency of a dependency, so scan both.

`--ignore-unfixed`-style triage matters here too. A CVE with no patch available isn't actionable, and a report full of them trains people to skip the report entirely. Alternatives: **Trivy** (`trivy fs .`) covers many ecosystems and is already in your toolchain if you followed the [IaC](/blog/devsecops-iac-security) or [container](/blog/devsecops-container-security) posts; **Dependabot** and **Renovate** open upgrade PRs automatically ([Git & GitHub security](/blog/devsecops-git-github-security)); **Grype** and **osv-scanner** are the other common CLIs.

The follow-on to SCA is an **SBOM** — an inventory you store, so the next Log4Shell is a database query instead of a week of rebuilding. That's in the [container security post](/blog/devsecops-container-security).

## Step 5: Run the app and prove the bugs are real

```bash
python app.py
```

Before scanning, exploit them by hand. Understanding *why* a finding is exploitable is the difference between fixing it and pattern-matching around it.

```bash
# Normal request
curl "http://127.0.0.1:5000/user?id=1"
# {"id": 1, "username": "alice"}

# SQL injection — user 99 doesn't exist, yet we get data back
curl "http://127.0.0.1:5000/user?id=99'%20OR%20'1'='1"
# {"id": 1, "username": "alice"}

# Arbitrary code execution via eval()
curl --get --data-urlencode "expr=__import__('os').getcwd()" \
     "http://127.0.0.1:5000/admin/calc"
# {"result": "/home/you/vulnerable-app"}

# Weak hashing — this MD5 is in every rainbow table ever built
curl "http://127.0.0.1:5000/hash?pw=admin"
# {"hash": "21232f297a57a5a743894a0e4a801fc3"}
```

That third one is the whole ballgame: `__import__('os')` inside `eval` means the attacker has your Python interpreter, and from there your filesystem and your environment variables — including the hardcoded `API_TOKEN` on line 13.

Two safety notes. Run this on `127.0.0.1`, never on a machine reachable from anywhere else — you have just built a remote code execution service. And only ever point the active scanner in the next step at an application you own.

## Step 6: DAST with OWASP ZAP

### Scan your own app, not Juice Shop

A very common version of this lab builds a vulnerable Flask app across five steps and then runs ZAP against **OWASP Juice Shop** instead. Juice Shop is an excellent target, but swapping it in here breaks the entire premise: you cannot compare SAST findings from `app.py` against DAST findings from a completely different application. The comparison table at the end becomes fiction.

Scan your app. (Juice Shop is worth a separate session — it's deliberately rich, and its findings are more interesting than a six-endpoint Flask app's.)

### Baseline scan — passive only

```bash
docker run --rm -v "$(pwd):/zap/wrk/:rw" \
  --add-host=host.docker.internal:host-gateway \
  -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py \
  -t http://host.docker.internal:5000 \
  -r zap-baseline-report.html
```

**A baseline scan will not find your SQL injection.** `zap-baseline.py` is **passive only** — it spiders the app and analyses the traffic that results, but sends no attack payloads. It reports missing security headers, cookie flags, information disclosure. Useful, safe against production, fast enough for every pull request, and structurally incapable of finding injection flaws.

This is the single most misunderstood thing about ZAP in CI. Teams run `zap-baseline.py`, see a clean-ish report, and believe they've been tested for OWASP Top 10 injection. They haven't.

### Full scan — active, and where the real findings are

```bash
docker run --rm -v "$(pwd):/zap/wrk/:rw" \
  --add-host=host.docker.internal:host-gateway \
  -t ghcr.io/zaproxy/zaproxy:stable \
  zap-full-scan.py \
  -t http://host.docker.internal:5000 \
  -r zap-full-report.html
```

`zap-full-scan.py` runs the **active scanner**: real attack payloads against every discovered parameter. This is what finds the SQL injection on `/user?id=` and the code injection on `/admin/calc?expr=`.

Because it sends real attacks, it **can create, modify, and delete data**. Never run it against production, and never against a system you don't own — that's an unauthorised attack regardless of intent. Staging or ephemeral environments only.

Two Docker details that cost people an hour each:

- **`host.docker.internal`** resolves automatically on Docker Desktop (macOS/Windows) but **not on Linux** — hence `--add-host=host.docker.internal:host-gateway`. Include it and the command works everywhere.
- **`:rw` on the volume mount** — the ZAP container runs as a non-root user, and without a writable mount the scan completes and then fails to write your report. If you still hit permission errors, `chmod 777` the output directory (a lab-only fix; in CI, write to a path the runner owns).

For the interactive UI:

```bash
docker run -it -p 8080:8080 ghcr.io/zaproxy/zaproxy:stable zap-webswing.sh
# then open http://localhost:8080/zap
```

The exit code is what makes this CI-usable: ZAP returns non-zero when it finds issues at or above your threshold. Tune with a `-c` config file that marks known-accepted alerts as `IGNORE`, otherwise the first noisy run gets the whole step marked `continue-on-error` and the gate is gone.

### What DAST structurally cannot find here

- **The hardcoded secrets** — invisible from outside until something leaks them.
- **The weak MD5 hash** — `/hash` returns a hash; nothing in the response says which algorithm.
- **The predictable token** — spotting `random.random()` from outside needs statistical analysis over many samples, not a scan.
- **The command injection on `/admin/ping`** — only if the spider finds that route. Undiscovered endpoints are unscanned endpoints, which is why an API scan driven by an OpenAPI spec (`zap-api-scan.py`) beats blind spidering for APIs.

That last point is the honest limitation of DAST: **it can only test what it can reach.** Authentication walls, multi-step flows, and undiscoverable routes are all invisible by default.

## Step 7: Compare the results

Actual coverage, from the runs above:

| Vulnerability | Bandit (SAST) | pip-audit (SCA) | ZAP full (DAST) |
| --- | --- | --- | --- |
| Hardcoded secrets | ✅ `B105` | ❌ | ❌ |
| SQL injection | ✅ `B608` | ❌ | ✅ active scan |
| Command injection (`shell=True`) | ✅ `B602` | ❌ | ⚠️ only if route found |
| `eval()` code execution | ✅ `B307` | ❌ | ✅ active scan |
| Weak MD5 hash | ✅ `B324` | ❌ | ❌ |
| Predictable token | ✅ `B311` | ❌ | ❌ |
| Flask `debug=True` | ✅ `B201` | ❌ | ✅ debugger exposed |
| Vulnerable Flask/Werkzeug/requests | ❌ | ✅ 8 CVEs | ❌ |
| Missing security headers | ❌ | ❌ | ✅ even baseline |
| Business logic flaws | ❌ | ❌ | ❌ |

Read the columns, not the rows. SAST has the broadest coverage and the least certainty — it flags patterns, and a human decides whether each is reachable. SCA has the narrowest coverage and the most certainty — a version either matches a CVE or it doesn't, which is why it's the easiest to gate a build on. DAST has the fewest findings and the highest confidence per finding, since each one is a demonstrated exploit.

And the last row is the one to remember: **all three tools are blank on business logic.**

## Step 8: Fixing what was found

```python
# SQL injection -> parameterised query
cursor.execute("SELECT id, username FROM users WHERE id = ?", (user_id,))

# eval() -> don't. If you truly need expressions, use a real parser.
import ast
result = ast.literal_eval(expr)      # literals only, no function calls

# Command injection -> no shell, argument list, validated input
import ipaddress, subprocess
ipaddress.ip_address(host)           # raises on anything that isn't an IP
subprocess.check_output(["ping", "-c", "1", host])   # note: no shell=True

# Hardcoded secrets -> environment / secret manager
import os
app.config["SECRET_KEY"] = os.environ["FLASK_SECRET_KEY"]

# Weak hash -> a password hash, not a message digest
from werkzeug.security import generate_password_hash
generate_password_hash(pw)           # or argon2 / bcrypt

# Predictable token -> the secrets module
import secrets
token = secrets.token_urlsafe(32)

# Debug mode -> never in production
app.run(host="0.0.0.0", port=5000)   # nosec B104 - containerised
```

```bash
pip-audit --fix -r requirements.txt   # dependencies
```

Two of these deserve a note. `ast.literal_eval` is safe for literals but is **not** a general `eval` replacement — if you need arithmetic, use a real expression parser rather than reaching back for `eval`. And `generate_password_hash` is a *password* hash (deliberately slow, salted); replacing MD5 with SHA-256 fixes the collision problem but leaves passwords brute-forceable at billions of guesses per second.

Then re-run all three scans. Watching the finding count drop is the part that makes this stick.

## Where each tool belongs in the pipeline

```text
IDE            pre-commit         Pull Request              Staging          Production
──────────────────────────────────────────────────────────────────────────────────────
Semgrep/       Gitleaks +         Bandit + Semgrep          ZAP full scan    Scheduled SCA
Bandit         Bandit (fast)      SonarQube quality gate    (active)         re-scan
plugin                            pip-audit / Trivy         ZAP API scan
                                  ZAP baseline (passive)
```

Four rules that decide whether this survives contact with a real team:

1. **Fast checks early, slow checks late.** Bandit takes a second; a ZAP full scan takes minutes to hours. Don't put the second one in a pre-commit hook.
2. **Gate on new code, not total findings.** SonarQube's "new code" quality gate is the mechanism; the equivalent for CLI tools is diff-scanning (`semgrep --baseline-commit`). Nobody fixes 4,000 legacy findings, and asking them to guarantees the tools get disabled.
3. **Start in warn mode, then enforce.** Same progression as Kyverno's `Audit` → `Enforce` in the [Kubernetes security lab](/blog/devsecops-kubernetes-security).
4. **Triage suppressions like code.** Every `# nosec` needs a rule ID and a reason, and should show up in review.

Scheduled re-scans matter more than they look: a CVE published tomorrow affects code you shipped today, with nothing in your repo having changed. SCA on a cron is how you find out.

## What this doesn't cover

- **Secret scanning** — Gitleaks, and GitHub push protection, catch the hardcoded key *before* it's committed rather than after ([Git & GitHub security](/blog/devsecops-git-github-security)).
- **IAST** — instruments the app during functional tests, combining SAST's code view with DAST's runtime view. Fewer false positives, but requires an agent in the runtime.
- **Container and IaC scanning** — the layers below your code, covered in the [container](/blog/devsecops-container-security) and [IaC](/blog/devsecops-iac-security) posts.
- **Threat modelling and code review** — the only things on this page that find business logic flaws.
- **Deeper practice** — [OWASP Juice Shop](https://owasp.org/www-project-juice-shop/) and WebGoat, once the concepts are clear.

## The takeaway

SAST reads what you wrote. SCA reads what you borrowed. DAST tests what you deployed. Three different questions, three different blind spots, and the reason a mature program runs all three rather than picking a favourite.

The habit worth taking away is the same one from the rest of this series: **verify the tool actually found the thing.** This lab plants a known bug of each class precisely so you can confirm each scanner's output matches reality — because a scanner you've never watched catch a real bug is a scanner you're trusting on faith.

This completes the DevSecOps series so far: [Git & GitHub](/blog/devsecops-git-github-security) for the source, [IaC](/blog/devsecops-iac-security) for the infrastructure, [containers](/blog/devsecops-container-security) for the images, [Kubernetes](/blog/devsecops-kubernetes-security) for the platform, and this for the application code itself.
