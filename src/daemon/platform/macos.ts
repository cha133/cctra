// ============================================================================
// macOS：写 ~/Library/LaunchAgents/com.cctra.daemon.plist + launchctl bootstrap
// 完全无 UI 痕迹（plain CLI + LaunchAgent = brew services 同款）
// ============================================================================
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { daemonLogPath } from "../../utils/paths";
import { info } from "../../ui/format";

const PLIST_LABEL = "com.cctra.daemon";
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);

export function installMacOS(daemonEntrypoint: string, bunPath: string = "/usr/bin/env"): void {
  if (process.platform !== "darwin") {
    throw new Error("installMacOS should only be called on macOS");
  }

  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  const plist = generatePlist(daemonEntrypoint, bunPath);
  writeFileSync(PLIST_PATH, plist, "utf-8");
  info(`wrote plist to ${PLIST_PATH}`);

  // 用 modern bootstrap 语法（避免 Apple Silicon deprecation warning）
  const uid = process.getuid?.() ?? execSync("id -u").toString().trim();
  try {
    execSync(`launchctl bootstrap gui/${uid} "${PLIST_PATH}"`, { stdio: "pipe" });
    info(`bootstrapped ${PLIST_LABEL}`);
  } catch (e) {
    // 可能已存在，先 bootout 再 bootstrap
    try {
      execSync(`launchctl bootout gui/${uid}/${PLIST_LABEL}`, { stdio: "pipe" });
    } catch { /* ignore */ }
    execSync(`launchctl bootstrap gui/${uid} "${PLIST_PATH}"`, { stdio: "pipe" });
    info(`bootstrapped ${PLIST_LABEL}`);
  }
}

export function uninstallMacOS(): void {
  if (process.platform !== "darwin") return;
  const uid = process.getuid?.() ?? execSync("id -u").toString().trim();
  try {
    execSync(`launchctl bootout gui/${uid}/${PLIST_LABEL}`, { stdio: "pipe" });
  } catch { /* not loaded */ }
  if (existsSync(PLIST_PATH)) unlinkSync(PLIST_PATH);
}

export function isInstalledMacOS(): boolean {
  return process.platform === "darwin" && existsSync(PLIST_PATH);
}

function generatePlist(daemonEntrypoint: string, bunPath: string): string {
  const log = daemonLogPath();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${bunPath}</string>
    <string>bun</string>
    <string>run</string>
    <string>${daemonEntrypoint}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>`;
}
