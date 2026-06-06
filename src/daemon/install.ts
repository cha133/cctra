// ============================================================================
// 平台分发：根据 process.platform 调对应的 installer
// ============================================================================
import { installWindows, isInstalledWindows, uninstallWindows } from "./platform/windows";
import { installMacOS, isInstalledMacOS, uninstallMacOS } from "./platform/macos";
import { installLinux, isInstalledLinux, uninstallLinux } from "./platform/linux";

export interface InstallOptions {
  /** 启动器 .exe 路径（Windows 专用） */
  bundledLauncherPath?: string;
  /** daemon 入口 .ts 路径（macOS / Linux 用） */
  daemonEntrypoint: string;
}

export function install(opts: InstallOptions): void {
  const platform = process.platform;
  if (platform === "win32") {
    if (!opts.bundledLauncherPath) {
      throw new Error("Windows install requires bundledLauncherPath");
    }
    installWindows(opts.bundledLauncherPath);
  } else if (platform === "darwin") {
    installMacOS(opts.daemonEntrypoint);
  } else if (platform === "linux") {
    installLinux(opts.daemonEntrypoint);
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  // 顶层不写 logger.info —— 外层 commands/daemon.ts 已有 success() 友好提示
}

export function uninstall(): void {
  const platform = process.platform;
  if (platform === "win32") uninstallWindows();
  else if (platform === "darwin") uninstallMacOS();
  else if (platform === "linux") uninstallLinux();
  else throw new Error(`Unsupported platform: ${platform}`);
  // 顶层不写 logger.info —— 外层 commands/daemon.ts 已有 success() 友好提示
}

export function isInstalled(): boolean {
  const platform = process.platform;
  if (platform === "win32") return isInstalledWindows();
  if (platform === "darwin") return isInstalledMacOS();
  if (platform === "linux") return isInstalledLinux();
  return false;
}
