#!/usr/bin/env node
// Runs before `tauri dev` (beforeDevCommand). Never fails and never downloads anything.
//
// The app does not bundle Node: it downloads the pinned Node.js release the first time a
// plugin needs it (Plugins page, "Install plugin runtime"). Debug builds can skip that by
// using a development copy, src-tauri/binaries/graphrt-node-<target-triple>, which
// scripts/fetch-node.sh downloads. This script only says whether that copy is there and
// matches scripts/node-version, so a stale one is noticed.
//
// The target comes from TAURI_ENV_TARGET_TRIPLE (set by the Tauri CLI), then from `rustc -vV`.
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

/**
 * Describes the development copy of Node for a target.
 *
 * @param targetTriple - Rust target triple such as `aarch64-apple-darwin` (string)
 * @returns `{ ready: true }`, or `{ ready: false, reason }` explaining what is missing or stale
 */
function describeDevelopmentNode(targetTriple) {
  const extension = targetTriple.includes("windows") ? ".exe" : "";
  const nodePath = join(binariesDir, `graphrt-node-${targetTriple}${extension}`);
  try {
    if (statSync(nodePath).size === 0) return { ready: false, reason: `${nodePath} is empty` };
  } catch {
    return { ready: false, reason: `no development copy at ${nodePath}` };
  }
  let stampVersion;
  try {
    stampVersion = readFileSync(`${nodePath}.stamp`, "utf8").trim().split(" ")[0];
  } catch {
    return { ready: false, reason: `no version stamp next to ${nodePath}` };
  }
  if (stampVersion !== pinnedVersion) {
    return { ready: false, reason: `${nodePath} is Node ${stampVersion}, expected ${pinnedVersion}` };
  }
  return { ready: true };
}

const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTargetTriple();
if (targetTriple) {
  const developmentNode = describeDevelopmentNode(targetTriple);
  if (!developmentNode.ready) {
    const fetchCommand = process.platform === "win32" ? "bash scripts/fetch-node.sh" : "scripts/fetch-node.sh";
    console.warn(
      `check-node-sidecar: ${developmentNode.reason}.\n` +
        `  Plugins will use the plugin runtime the app downloads (or a node on PATH in debug builds).\n` +
        `  To use a local copy of Node v${pinnedVersion} instead: ${fetchCommand} ${targetTriple}`,
    );
  }
} else {
  console.warn("check-node-sidecar: cannot tell the target triple (rustc not found); skipped");
}
