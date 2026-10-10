import { readdirSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..");
const distRoot = path.join(webRoot, "dist", "node-tests");
const testRoot = path.join(distRoot, "tests");

function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: webRoot,
    stdio: "inherit",
    env: process.env,
  });
  // A spawn failure leaves `status` null and puts the reason on `error`;
  // reporting it here keeps the script from exiting silently.
  if (result.error) {
    console.error(`Failed to run ${cmd}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function collectTests(dir) {
  const entries = readdirSync(dir)
    .map((name) => path.join(dir, name))
    .sort((a, b) => a.localeCompare(b));
  const files = [];
  for (const entry of entries) {
    const stats = statSync(entry);
    if (stats.isDirectory()) {
      files.push(...collectTests(entry));
      continue;
    }
    if (entry.endsWith(".test.js") || entry.endsWith(".test.mjs")) {
      files.push(entry);
    }
  }
  return files;
}

rmSync(distRoot, { recursive: true, force: true });

// Compile through the current Node binary rather than the node_modules/.bin
// shim: on Windows the extensionless shim is ENOENT and the .cmd shim cannot
// be spawned without a shell (EINVAL), which made this script exit silently.
run(process.execPath, [
  path.join(webRoot, "node_modules", "typescript", "bin", "tsc"),
  "-p",
  "tsconfig.node-tests.json",
]);

const testFiles = collectTests(testRoot);
// Native ESM tests exercise the same ESM-only Markdown plugins as the browser.
testFiles.push(...collectTests(path.join(webRoot, "tests")).filter((file) => file.endsWith(".test.mjs")));
if (testFiles.length === 0) {
  console.error("No compiled node tests found.");
  process.exit(1);
}

run(process.execPath, ["--test", ...testFiles]);
