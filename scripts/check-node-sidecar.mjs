#!/usr/bin/env node
// Fails `tauri dev` / `tauri build` early (as part of beforeDevCommand /
// beforeBuildCommand) when the Node.js sidecar for the target is missing or
// does not match scripts/node-version, with the command that fixes it.
// It never downloads anything: run scripts/fetch-node.sh for that.
//
// The target comes from TAURI_ENV_TARGET_TRIPLE (set by the Tauri CLI), then
// from `rustc -vV`. `universal-apple-darwin` needs both macOS arches and the
// universal binary.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const binariesDir = join(repoRoot, "src-tauri", "binaries");
const pinnedVersion = readFileSync(join(repoRoot, "scripts", "node-version"), "utf8").trim();

function hostTargetTriple() {
  try {
    const rustcInfo = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
    return rustcInfo.match(/^host: (.+)$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function sidecarProblem(targetTriple) {
  const extension = targetTriple.includes("windows") ? ".exe" : "";
  const sidecarPath = join(binariesDir, `graphrt-node-${targetTriple}${extension}`);
  let sidecarSize = 0;
  try {
    sidecarSize = statSync(sidecarPath).size;
  } catch {
    return `missing ${sidecarPath}`;
  }
  if (sidecarSize === 0) return `empty ${sidecarPath}`;
  // The lipo'd universal binary has no stamp; its arch binaries are checked separately.
  if (targetTriple === "universal-apple-darwin") return undefined;
  let stampVersion = "";
  try {
    stampVersion = readFileSync(`${sidecarPath}.stamp`, "utf8").split(" ")[0];
  } catch {
    return `no version stamp next to ${sidecarPath}`;
  }
  if (stampVersion !== pinnedVersion) return `${sidecarPath} is Node ${stampVersion}, expected ${pinnedVersion}`;
  return undefined;
}

const requestedTarget = process.env.TAURI_ENV_TARGET_TRIPLE || hostTargetTriple();
if (!requestedTarget) {
  console.error("check-node-sidecar: cannot tell the target triple (rustc not found)");
  process.exit(1);
}
const targetsToCheck =
  requestedTarget === "universal-apple-darwin"
    ? ["aarch64-apple-darwin", "x86_64-apple-darwin", "universal-apple-darwin"]
    : [requestedTarget];
const problems = targetsToCheck.map(sidecarProblem).filter(Boolean);
if (problems.length > 0) {
  console.error(`\nThe bundled Node.js runtime (v${pinnedVersion}) is not ready:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  // fetch-node.sh is a bash script; on Windows it runs in Git Bash.
  const fetchCommand = process.platform === "win32" ? "bash scripts/fetch-node.sh" : "scripts/fetch-node.sh";
  console.error(`\nFetch it (needs network, about 30-50 MB per target) with:\n  ${fetchCommand} ${requestedTarget}\n`);
  process.exit(1);
}
