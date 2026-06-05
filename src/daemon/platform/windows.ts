// ============================================================================
// Windows：注册表 HKCU\Run（无 UAC）+ 拷贝 Rust 启动器到 ~/.cctra/bin/
// ============================================================================
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ensureCctraDir, windowsLauncherPath } from "../../utils/paths";
import { logger } from "../../utils/logger";

const REG_KEY = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run`;
const REG_NAME = "cctra";

/** 把 Rust 启动器从 src-tauri/ 拷贝到 ~/.cctra/bin/，然后注册到 Run key */
export function installWindows(bundledLauncherPath: string): void {
  if (process.platform !== "win32") {
    throw new Error("installWindows should only be called on Windows");
  }

  ensureCctraDir();
  const dest = windowsLauncherPath();
  mkdirSync(dirname(dest), { recursive: true });

  // 拷贝 .exe
  if (!existsSync(bundledLauncherPath)) {
    throw new Error(`Bundled launcher not found: ${bundledLauncherPath}. Build it first with scripts/build-launcher.ps1`);
  }
  copyFileSync(bundledLauncherPath, dest);
  logger.info(`[windows] copied launcher to ${dest}`);

  // 写注册表（HKCU 不需要管理员）
  const cmd = `reg add "${REG_KEY}" /v ${REG_NAME} /t REG_SZ /d "\"${dest}\"" /f`;
  try {
    execSync(cmd, { stdio: "pipe" });
    logger.info(`[windows] registered ${REG_NAME} in ${REG_KEY}`);
  } catch (e) {
    throw new Error(`Failed to register Run key: ${(e as Error).message}`);
  }
}

export function uninstallWindows(): void {
  if (process.platform !== "win32") return;

  try {
    execSync(`reg delete "${REG_KEY}" /v ${REG_NAME} /f`, { stdio: "pipe" });
    logger.info(`[windows] removed ${REG_NAME} from ${REG_KEY}`);
  } catch {
    // 没注册过，忽略
  }

  const dest = windowsLauncherPath();
  if (existsSync(dest)) {
    try {
      execSync(`del /f "${dest}"`, { stdio: "pipe" });
    } catch {
      // ignore
    }
  }
}

/** 检测是否已注册 */
export function isInstalledWindows(): boolean {
  if (process.platform !== "win32") return false;
  try {
    const out = execSync(`reg query "${REG_KEY}" /v ${REG_NAME}`, { stdio: "pipe" }).toString();
    return out.includes(REG_NAME);
  } catch {
    return false;
  }
}
