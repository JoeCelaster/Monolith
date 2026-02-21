#!/usr/bin/env node

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "fs";
import { resolve, join, dirname, relative } from "path";
import { fileURLToPath } from "url";

// ── Helpers ──────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEMPLATES_DIR = join(__dirname, "templates");
const TARGET_DIR = join(process.cwd(), ".github", "workflows");

const args = process.argv.slice(2);
const force = args.includes("--force");

const green = (t) => `\x1b[32m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red = (t) => `\x1b[31m${t}\x1b[0m`;
const bold = (t) => `\x1b[1m${t}\x1b[0m`;

function log(msg) {
  console.log(`  ${msg}`);
}

// ── Copy logic ───────────────────────────────────────────────────────

/**
 * Recursively copy every file from `srcDir` into `destDir`,
 * preserving the relative folder structure.
 */
function copyDir(srcDir, destDir) {
  const entries = readdirSync(srcDir);

  for (const entry of entries) {
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);

    if (statSync(srcPath).isDirectory()) {
      // Recurse into sub-directories
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

function copyFile(src, dest) {
  const relPath = relative(process.cwd(), dest);

  if (existsSync(dest) && !force) {
    log(yellow(`⏭  Skipped (already exists): ${relPath}`));
    log(`   Use ${bold("--force")} to overwrite.`);
    return;
  }

  // Ensure the destination directory exists
  const destDir = dirname(dest);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  copyFileSync(src, dest);
  log(green(`✔  Copied: ${relPath}`));
}

// ── Main ─────────────────────────────────────────────────────────────

function main() {
  console.log();
  log(bold("mono-lith") + " — GitHub Actions workflow scaffolder");
  console.log();

  // Validate templates directory exists inside the package
  if (!existsSync(TEMPLATES_DIR)) {
    log(red("✖  Templates directory not found inside the package."));
    process.exit(1);
  }

  // Check that there is at least one template file
  const templates = readdirSync(TEMPLATES_DIR);
  if (templates.length === 0) {
    log(red("✖  No template files found."));
    process.exit(1);
  }

  if (force) {
    log(yellow("⚠  --force enabled — existing files will be overwritten.\n"));
  }

  try {
    copyDir(TEMPLATES_DIR, TARGET_DIR);
  } catch (err) {
    console.log();
    log(red(`✖  Error copying files: ${err.message}`));
    process.exit(1);
  }

  console.log();
  log(green("Done! Workflow files are in .github/workflows/"));
  console.log();
}

main();
