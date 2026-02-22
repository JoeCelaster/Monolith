#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { input, select, confirm } from "@inquirer/prompts";
import { fileURLToPath } from "url";

// ─── Paths ───────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ROOT         = path.resolve(__dirname, "..");
const PRESETS_DIR  = path.join(ROOT, "presets");
const TEMPLATES_DIR = path.join(ROOT, "templates");

// ─── Helpers ─────────────────────────────────────────────────────────────────
function readTemplate(relPath) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, relPath), "utf8");
}

function writeFile(targetPath, content) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf8");
}

function replacePlaceholders(str, vars) {
  let out = str;
  for (const [key, val] of Object.entries(vars)) {
    const re = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    out = out.replace(re, val ?? "");
  }
  return out;
}

function makeExecutable(p) {
  try { fs.chmodSync(p, 0o755); } catch { /* Windows – ignore */ }
}

/**
 * Remove a named YAML step block and everything under it until the next sibling step.
 * Works on indented step blocks (e.g. `      - name: Run migrations (staging)`).
 */
function removeStepBlock(yaml, stepNameSubstring) {
  const lines = yaml.split("\n");
  const result = [];
  let skipping = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Start skipping when we hit a step whose name contains the target substring
    if (!skipping && trimmed.startsWith("- name:") && trimmed.includes(stepNameSubstring)) {
      skipping = true;
      continue;
    }
    // Stop skipping at the next sibling step (same indentation `      - name:`)
    if (skipping && line.match(/^\s+- (name:|uses:|run:)/) && !trimmed.includes(stepNameSubstring)) {
      skipping = false;
    }
    if (!skipping) result.push(line);
  }
  return result.join("\n");
}

// ─── Load presets ────────────────────────────────────────────────────────────
const presets = {
  node:   JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, "node.json"),   "utf8")),
  java:   JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, "java.json"),   "utf8")),
  python: JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, "python.json"), "utf8")),
};

// ─── CLI ─────────────────────────────────────────────────────────────────────
async function main() {
  const cwd        = process.cwd();
  const folderName = path.basename(cwd);

  console.log("\n🧱  Monolith — Production-Ready CI/CD Scaffolder\n");

  const projectName = await input({
    message: "Project name:",
    default: folderName,
  });

  const stack = await select({
    message: "Choose stack:",
    choices: [
      { name: "Node.js (Express / Next.js)", value: "node"   },
      { name: "Java (Spring Boot)",           value: "java"   },
      { name: "Python (FastAPI / Flask)",     value: "python" },
    ],
    pageSize: 3,
    loop: false,
  });

  const preset = presets[stack];

  const prodBranch = await input({
    message: "Production branch:",
    default: "main",
  });

  const stagingBranch = await input({
    message: "Staging branch:",
    default: "staging",
  });

  const installCommand = await input({
    message: "Install command:",
    default: preset.installCommand,
  });

  const lintCommand = await input({
    message: "Lint command:",
    default: preset.lintCommand,
  });

  const testCommand = await input({
    message: "Test command:",
    default: preset.testCommand,
  });

  const useDocker = await confirm({
    message: "Use Docker for build & deploy? (recommended for production)",
    default: true,
  });

  const mode = await select({
    message: "Pipeline mode:",
    choices: [
      {
        name: "Simple  — single monolith.yml file, one job, local Docker smoke test (great for demos/hackathons)",
        value: "simple",
      },
      {
        name: "Production — 5 workflow files, GHCR registry, SSH deploy, staging + production environments",
        value: "production",
      },
    ],
    pageSize: 2,
    loop: false,
  });

  const migrationCommand = mode === "production"
    ? await input({
        message: "Migration command (leave empty to skip migration step):",
        default: "",
      })
    : "";

  // ─── Build variable map ──────────────────────────────────────────────────
  const imageName = projectName.toLowerCase().replace(/[^a-z0-9-_]/g, "");

  const vars = {
    APP_NAME:          imageName,   // sanitised: lowercase, no spaces — safe for container names & FS paths
    IMAGE_NAME:        imageName,
    PORT:              String(preset.defaultPort || 3000),
    RUNTIME_VERSION:   preset.runtimeVersion || "latest",
    INSTALL_COMMAND:   installCommand,
    LINT_COMMAND:      lintCommand,
    TEST_COMMAND:      testCommand,
    BUILD_COMMAND:     preset.buildCommand || `echo "No build step"`,
    PROD_BRANCH:       prodBranch,
    STAGING_BRANCH:    stagingBranch,
    MIGRATION_COMMAND: migrationCommand.trim(),
    HEALTH_PATH:       preset.healthPath || "/health",
  };

  const workflowsOut = path.join(cwd, ".github", "workflows");
  const scriptsOut   = path.join(cwd, "scripts");

  // ─── SIMPLE MODE: one file, one job, local Docker smoke test ─────────────
  if (mode === "simple") {
    // Single unified workflow
    writeFile(
      path.join(workflowsOut, "monolith.yml"),
      replacePlaceholders(readTemplate(`workflows/monolith.${stack}.yml.template`), vars)
    );

    // Dockerfile + .dockerignore (only when Docker is enabled)
    if (useDocker) {
      writeFile(
        path.join(cwd, "Dockerfile"),
        replacePlaceholders(readTemplate(`docker/Dockerfile.${stack}.template`), vars)
      );
      const dockerignorePath = path.join(cwd, ".dockerignore");
      if (!fs.existsSync(dockerignorePath)) {
        writeFile(dockerignorePath, readTemplate("docker/.dockerignore.template"));
      }
    }

    console.log("\n✅  Monolith scaffolded your simple CI/CD pipeline!\n");
    console.log("📁 Generated files:");
    console.log("  .github/workflows/");
    console.log("    monolith.yml         ← single-file: CI → Docker build → smoke test");
    if (useDocker) {
      console.log("  Dockerfile             ← multi-stage, non-root, HEALTHCHECK");
      console.log("  .dockerignore          ← excludes secrets, node_modules, .git…");
    }
    console.log("\nℹ️  Working directory: set the WORK_DIR repository variable in");
    console.log("   GitHub Settings → Variables if your project is in a sub-folder.");
    console.log("\n➡️  Next steps:");
    console.log("  1. git add .");
    console.log('  2. git commit -m "chore: add Monolith CI/CD"');
    console.log("  3. git push  —  workflow runs on every push to", prodBranch, "/", stagingBranch, "and PRs\n");
    return;
  }

  // ─── PRODUCTION MODE: 5 workflow files + scripts + SSH deploy ────────────

  // CI
  writeFile(
    path.join(workflowsOut, "ci.yml"),
    replacePlaceholders(readTemplate(`workflows/ci.${stack}.yml.template`), vars)
  );

  // Build
  const buildTplName = useDocker
    ? "workflows/build.docker.yml.template"
    : "workflows/build.basic.yml.template";
  writeFile(
    path.join(workflowsOut, "build.yml"),
    replacePlaceholders(readTemplate(buildTplName), vars)
  );

  // Deploy — strip migration step blocks when no migration command was given
  let deployTpl = readTemplate("workflows/deploy.yml.template");
  if (!vars.MIGRATION_COMMAND) {
    deployTpl = removeStepBlock(deployTpl, "Run migrations");
  }
  writeFile(
    path.join(workflowsOut, "deploy.yml"),
    replacePlaceholders(deployTpl, vars)
  );

  // Rollback
  writeFile(
    path.join(workflowsOut, "rollback.yml"),
    replacePlaceholders(readTemplate("workflows/rollback.yml.template"), vars)
  );

  // Security scan
  writeFile(
    path.join(workflowsOut, "security-scan.yml"),
    replacePlaceholders(readTemplate("workflows/security-scan.yml.template"), vars)
  );

  // Shell scripts
  const scripts = [
    ["scripts/deploy.sh.template",        "deploy.sh"      ],
    ["scripts/rollback.sh.template",      "rollback.sh"    ],
    ["scripts/health-check.sh.template",  "health-check.sh"],
  ];
  for (const [tplRel, outName] of scripts) {
    const destPath = path.join(scriptsOut, outName);
    writeFile(destPath, replacePlaceholders(readTemplate(tplRel), vars));
    makeExecutable(destPath);
  }

  // Dockerfile + .dockerignore
  if (useDocker) {
    writeFile(
      path.join(cwd, "Dockerfile"),
      replacePlaceholders(readTemplate(`docker/Dockerfile.${stack}.template`), vars)
    );
    const dockerignorePath = path.join(cwd, ".dockerignore");
    if (!fs.existsSync(dockerignorePath)) {
      writeFile(dockerignorePath, readTemplate("docker/.dockerignore.template"));
    }
  }

  // ─── Summary (production) ─────────────────────────────────────────────────
  console.log("\n✅  Monolith scaffolded your production CI/CD pipeline!\n");
  console.log("📁 Generated files:");
  console.log("  .github/workflows/");
  console.log("    ci.yml               ← lint + test on every push/PR");
  console.log("    build.yml            ← " + (useDocker ? "Docker build→push to GHCR + Trivy scan" : "build artifact upload"));
  console.log("    deploy.yml           ← staging (auto) → production (approval gate)");
  console.log("    rollback.yml         ← manual rollback to any SHA");
  console.log("    security-scan.yml    ← weekly Trivy FS + Gitleaks secret scan");
  console.log("  scripts/");
  console.log("    deploy.sh            ← SSH server-side: pull GHCR image & restart");
  console.log("    rollback.sh          ← SSH server-side: restore exact previous image");
  console.log("    health-check.sh      ← poll " + vars.HEALTH_PATH + " until 2xx or timeout");
  if (useDocker) {
    console.log("  Dockerfile             ← multi-stage, non-root, HEALTHCHECK");
    console.log("  .dockerignore          ← excludes secrets, node_modules, .git…");
  }

  console.log("\n🔐  GitHub Secrets required (Settings → Secrets → Actions):");
  console.log("  PROD_HOST          Your production server IP / hostname");
  console.log("  STAGING_HOST       Your staging server IP / hostname");
  console.log("  DEPLOY_USER        SSH username on both servers");
  console.log("  DEPLOY_SSH_KEY     Private SSH key (matching authorized_keys on servers)");

  console.log("\n🏗️  GitHub Environments required (Settings → Environments):");
  console.log("  staging     — no approval needed (auto-deployed)");
  console.log("  production  — add required reviewers for manual approval gate");

  console.log("\n📋  Server setup (run once per server):");
  console.log(`  mkdir -p /opt/scripts/${imageName}`);
  console.log(`  mkdir -p /etc/${imageName}`);
  console.log(`  # Place staging.env / production.env in /etc/${imageName}/`);
  console.log(`  # Copy deploy.sh & rollback.sh to /opt/scripts/${imageName}/`);

  console.log("\n➡️  Next steps:");
  console.log("  1. git add .");
  console.log('  2. git commit -m "chore: add Monolith production CI/CD"');
  console.log("  3. git push  —  CI runs immediately on every branch");
  console.log("  4. Merge to", stagingBranch, "→ auto-deploys to staging");
  console.log("  5. Merge to", prodBranch, "→ requests production approval → deploys\n");
}

main().catch((err) => {
  console.error("❌ Error:", err.message ?? err);
  process.exit(1);
});