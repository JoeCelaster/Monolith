# 🧱 Monolith — Production-Ready CI/CD Scaffolder

**One command. Complete, production-grade GitHub Actions pipeline instantly scaffolded into any Node.js, Java, or Python project.**

---

## What it does

`monolithx` is an interactive CLI that writes a full CI/CD pipeline into your repository. Run it once, answer a few prompts, push — and every future commit is automatically linted, tested, built, scanned, deployed to staging, and promoted to production through an approval gate, with instant rollback at any time.

---

## Pipeline architecture

```
Every push / PR
      │
      ▼
┌─────────────┐
│  CI          │  lint + test  (setup-node / setup-java / setup-python + dep cache)
└──────┬──────┘
       │ success on prod/staging branch
       ▼
┌─────────────┐
│  Build      │  docker build → push to GHCR (immutable SHA tag)
│             │  Trivy image scan (blocks on CRITICAL/HIGH CVEs)
└──────┬──────┘
       │
       ├──────────────────────────────────────────────────────────┐
       │  head_branch == staging                                  │  head_branch == main
       ▼                                                          ▼
┌─────────────┐                                        ┌──────────────────────┐
│  Deploy     │                                        │  Deploy              │
│  Staging    │  auto  (GitHub Environment: staging)   │  Production          │
│             │  SSH → docker pull exact SHA → run      │  ← manual approval   │
│             │  health check → auto-rollback on fail   │  (GitHub Environment)│
└─────────────┘                                        └──────────────────────┘

Manual at any time:
  workflow_dispatch → Rollback workflow → specify any SHA → SSH → redeploy → health check
  workflow_dispatch → Security Scan     → Trivy FS + Gitleaks (also runs weekly)
```

---

## Quick start

```bash
# Install globally
npm install -g monolithx

# Run inside your project root
cd my-project
monolithx
```

The CLI will prompt you for:

| Prompt | Default | Notes |
|---|---|---|
| Project name | folder name | Used as container name and image name |
| Stack | — | Node.js, Java, Python |
| Production branch | `main` | Auto-deploys here after approval |
| Staging branch | `staging` | Auto-deploys here on every push |
| Install command | preset | e.g. `npm ci` |
| Lint command | preset | e.g. `npm run lint --if-present` |
| Test command | preset | e.g. `npm test` |
| Use Docker? | yes | Recommended for production |
| Migration command | empty | Optional; run before container swap |

---

## Generated files

```
.github/
  workflows/
    ci.yml               ← lint + test on every push / PR
    build.yml            ← Docker build → GHCR push + Trivy scan
    deploy.yml           ← staging (auto) / production (approval gate)
    rollback.yml         ← manual rollback to any image SHA
    security-scan.yml    ← weekly Trivy FS + Gitleaks secret scan

scripts/
  deploy.sh              ← runs on server via SSH: pull exact image, restart
  rollback.sh            ← runs on server via SSH: restore previous or explicit SHA
  health-check.sh        ← polls health endpoint until 2xx or timeout

Dockerfile               ← multi-stage, non-root user, HEALTHCHECK
.dockerignore            ← excludes .git, secrets, node_modules, etc.
```

---

## Prerequisites

### GitHub Secrets (`Settings → Secrets and variables → Actions`)

| Secret | Description |
|---|---|
| `PROD_HOST` | Production server IP or hostname |
| `STAGING_HOST` | Staging server IP or hostname |
| `DEPLOY_USER` | SSH username on both servers |
| `DEPLOY_SSH_KEY` | Private SSH key (ed25519 recommended) |

> `GITHUB_TOKEN` is used automatically for GHCR login and SARIF uploads — no manual setup needed.

### GitHub Environments (`Settings → Environments`)

| Environment | Recommended settings |
|---|---|
| `staging` | No protection rules (fully automatic) |
| `production` | Add **required reviewers** → creates an approval gate before every production deploy |

### Server setup (one-time, per server)

```bash
# Create directories
mkdir -p /opt/scripts/<your-app-name>
mkdir -p /etc/<your-app-name>

# Copy scripts from your repo to the server
scp scripts/deploy.sh  user@server:/opt/scripts/<app>/deploy.sh
scp scripts/rollback.sh user@server:/opt/scripts/<app>/rollback.sh
chmod +x /opt/scripts/<app>/*.sh

# Place environment files (never commit these)
# /etc/<app>/staging.env
# /etc/<app>/production.env

# Add the GitHub Actions SSH public key to authorized_keys
echo "<public-key>" >> ~/.ssh/authorized_keys

# Ensure Docker is installed and the deploy user can run Docker
```

---

## Rollback

Rollback is a `workflow_dispatch` — go to **Actions → Rollback → Run workflow**.

- Enter the **exact image SHA** you want to roll back to (visible in the Build & Push job log).
- Select the target environment (`staging` or `production`).
- The workflow SSHes into the server, `docker pull`s the exact immutable image, swaps the container, and verifies health.

The `deploy.sh` script also records the running image tag before each deploy, enabling `IMAGE_TAG=previous` rollback without needing to look up a SHA.

---

## Security

- **GHCR images** are tagged with the full commit SHA (immutable) — `latest` is never deployed to production.
- **Trivy** scans every built image for CRITICAL and HIGH CVEs before the deploy step can run. Results appear in the GitHub Security tab.
- **Gitleaks** scans the full git history for accidentally committed secrets on every push to main/staging.
- **Secrets** are injected at runtime via `--env-file` on the server — never baked into the image.
- **Non-root users** in all three Dockerfile templates.
- **Supply chain**: pinned major versions on all Actions (`@v4`, `@v3`, etc.).

---

## Stack presets

| Stack | Runtime | Install | Lint | Test | Server |
|---|---|---|---|---|---|
| Node.js | Node 20 | `npm ci` | `npm run lint` | `npm test` | `npm start` |
| Java | JDK 21 (Temurin) | `mvn dependency:go-offline` | Checkstyle | `mvn verify` | JVM container flags |
| Python | Python 3.11 | `pip install -r requirements.txt` | ruff / flake8 | `pytest` | gunicorn + uvicorn |

---

## Frequently asked questions

**Q: Where does the Docker image actually run?**  
A: On your own server (VPS, EC2, Droplet, etc.). The GitHub Actions runner builds and pushes the image to GHCR, then SSHes into your server to pull and start it. The runner itself is ephemeral.

**Q: Can I use this with Kubernetes?**  
A: The `deploy.sh` and `rollback.sh` scripts are the only server-side concern. Replace their contents with `kubectl set image` / `kubectl rollout undo` commands to target a Kubernetes cluster instead.

**Q: What if I don't want Docker?**  
A: Answer "No" to the Docker prompt. The build step uploads a plain artifact (`dist/`) instead, and you'll need to adapt `deploy.sh` to copy and run that artifact on your server.

**Q: How do I update the pipeline after initial setup?**  
A: Re-run `monolithx` — it overwrites the generated files. Commit the changes and push.

---

## License

MIT
