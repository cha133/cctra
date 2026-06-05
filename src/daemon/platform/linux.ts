// ============================================================================
// Linux：写 ~/.config/systemd/user/cctra.service + systemctl --user enable
// ============================================================================
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { daemonLogPath } from "../../utils/paths";
import { logger } from "../../utils/logger";

const UNIT_NAME = "cctra.service";
const UNIT_PATH = join(homedir(), ".config", "systemd", "user", UNIT_NAME);

export function installLinux(daemonEntrypoint: string, bunPath: string = "/usr/bin/env"): void {
  if (process.platform !== "linux") {
    throw new Error("installLinux should only be called on Linux");
  }

  mkdirSync(join(homedir(), ".config", "systemd", "user"), { recursive: true });
  const unit = generateUnit(daemonEntrypoint, bunPath);
  writeFileSync(UNIT_PATH, unit, "utf-8");
  logger.info(`[linux] wrote unit to ${UNIT_PATH}`);

  try {
    execSync("systemctl --user daemon-reload", { stdio: "pipe" });
    execSync("systemctl --user enable --now cctra.service", { stdio: "pipe" });
    logger.info(`[linux] enabled and started cctra.service`);
  } catch (e) {
    throw new Error(`systemctl failed: ${(e as Error).message}`);
  }
}

export function uninstallLinux(): void {
  if (process.platform !== "linux") return;
  try {
    execSync("systemctl --user disable --now cctra.service", { stdio: "pipe" });
  } catch { /* not enabled */ }
  if (existsSync(UNIT_PATH)) unlinkSync(UNIT_PATH);
  try {
    execSync("systemctl --user daemon-reload", { stdio: "pipe" });
  } catch { /* ignore */ }
}

export function isInstalledLinux(): boolean {
  return process.platform === "linux" && existsSync(UNIT_PATH);
}

function generateUnit(daemonEntrypoint: string, _bunPath: string): string {
  const log = daemonLogPath();
  return `[Unit]
Description=cctra daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env bun run ${daemonEntrypoint}
Restart=always
RestartSec=3
StandardOutput=append:${log}
StandardError=append:${log}

[Install]
WantedBy=default.target
`;
}
