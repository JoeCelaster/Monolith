#!/usr/bin/env node

import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import { fileURLToPath } from "url";

// --- Paths ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const PRESETS_DIR = path.join(ROOT, "presets");
const TEMPLATES_DIR = path.join(ROOT, "templates");

// --- Helpers ---
function readTemplate(relPath) {
  const p = path.join(TEMPLATES_DIR, relPath);
  return fs.readFileSync(p, "utf8");
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
  try {
    fs.chmodSync(p, 0o755);
  } catch {}
}

// --- Load presets ---
const presets = {
  node: JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, "node.json"), "utf8")),
  java: JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, "java.json"), "utf8")),
  python: JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, "python.json"), "utf8")),
};

// --- CLI ---
async function main() {
  const cwd = process.cwd();
  const folderName = path.basename(cwd);

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "projectName",
      message: "Project name:",
      default: folderName,
    },
    {
      type: "list",
      name: "stack",
      message: "Choose stack:",
      choices: [
        { name: "Node.js (Express)", value: "node" },
        { name: "Java (Spring Boot)", value: "java" },
        { name: "Python (FastAPI/Flask)", value: "python" },
      ],
      default: "node",
    },
    {
      type: "input",
      name: "prodBranch",
      message: "Branch for production:",
      default: "main",
    },
    {
      type: "input",
      name: "installCommand",
      message: "Install command:",
      default: (ans) => presets[ans.stack].installCommand,
    },
    {
      type: "input",
      name: "testCommand",
      message: "Test command:",
      default: (ans) => presets[ans.stack].testCommand,
    },
    {
      type: "confirm",
      name: "useDocker",
      message: "Use Docker for build & deploy?",
      default: true,
    },
    {
      type: "input",
      name: "migrationCommand",
      message: "Migration command (leave empty for none):",
      default: "",
    },
  ]);

  const preset = presets[answers.stack];

  const vars = {
    APP_NAME: answers.projectName,
    IMAGE_NAME: answers.projectName.toLowerCase().replace(/[^a-z0-9-_]/g, ""),
    PORT: String(preset.defaultPort || 3000),
    INSTALL_COMMAND: answers.installCommand,
    TEST_COMMAND: answers.testCommand,
    BUILD_COMMAND: preset.buildCommand || "echo \"No build step\"",
    PROD_BRANCH: answers.prodBranch,
    MIGRATION_COMMAND: answers.migrationCommand,
  };

  // --- Generate workflows ---
  const workflowsOut = path.join(cwd, ".github", "workflows");

  // CI
  let ciTpl = readTemplate("workflows/ci.yml.template");
  let ciYml = replacePlaceholders(ciTpl, vars);
  writeFile(path.join(workflowsOut, "ci.yml"), ciYml);

  // Build
  if (answers.useDocker) {
    let buildTpl = readTemplate("workflows/build.docker.yml.template");
    let buildYml = replacePlaceholders(buildTpl, vars);
    writeFile(path.join(workflowsOut, "build.yml"), buildYml);
  } else {
    let buildTpl = readTemplate("workflows/build.basic.yml.template");
    let buildYml = replacePlaceholders(buildTpl, vars);
    writeFile(path.join(workflowsOut, "build.yml"), buildYml);
  }

  // Deploy (handle optional migration step)
  let deployTpl = readTemplate("workflows/deploy.yml.template");
  if (!answers.migrationCommand || !answers.migrationCommand.trim()) {
    // remove the migration step block (simple approach: remove lines containing MIGRATION_COMMAND)
    deployTpl = deployTpl
      .split("\n")
      .filter((line) => !line.includes("MIGRATION_COMMAND") && !line.toLowerCase().includes("run migrations"))
      .join("\n");
  }
  let deployYml = replacePlaceholders(deployTpl, vars);
  writeFile(path.join(workflowsOut, "deploy.yml"), deployYml);

  // Rollback
  let rollbackTpl = readTemplate("workflows/rollback.yml.template");
  let rollbackYml = replacePlaceholders(rollbackTpl, vars);
  writeFile(path.join(workflowsOut, "rollback.yml"), rollbackYml);

  // --- Scripts ---
  const scriptsOut = path.join(cwd, "scripts");
  const deploySh = replacePlaceholders(readTemplate("scripts/deploy.sh.template"), vars);
  const rollbackSh = replacePlaceholders(readTemplate("scripts/rollback.sh.template"), vars);
  const healthSh = replacePlaceholders(readTemplate("scripts/health-check.sh.template"), vars);

  writeFile(path.join(scriptsOut, "deploy.sh"), deploySh);
  writeFile(path.join(scriptsOut, "rollback.sh"), rollbackSh);
  writeFile(path.join(scriptsOut, "health-check.sh"), healthSh);

  makeExecutable(path.join(scriptsOut, "deploy.sh"));
  makeExecutable(path.join(scriptsOut, "rollback.sh"));
  makeExecutable(path.join(scriptsOut, "health-check.sh"));

  // --- Dockerfile (optional) ---
  if (answers.useDocker) {
    let dockerTplName =
      answers.stack === "java"
        ? "docker/Dockerfile.java.template"
        : answers.stack === "python"
        ? "docker/Dockerfile.python.template"
        : "docker/Dockerfile.node.template";

    let dockerTpl = readTemplate(dockerTplName);
    let dockerfile = replacePlaceholders(dockerTpl, vars);
    writeFile(path.join(cwd, "Dockerfile"), dockerfile);
  }

  console.log("\n✅ Monolith added CI/CD to your project!");
  console.log("📁 Generated:");
  console.log("  - .github/workflows/{ci,build,deploy,rollback}.yml");
  console.log("  - scripts/{deploy,rollback,health-check}.sh");
  if (answers.useDocker) console.log("  - Dockerfile");
  console.log("\n➡️ Next steps:");
  console.log("  1) git add .");
  console.log('  2) git commit -m "Add Monolith CI/CD"');
  console.log("  3) git push");
  console.log("\nEvery push will now run CI, build, deploy, and allow rollback. 🚀");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});