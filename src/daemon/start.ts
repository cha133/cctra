// ============================================================================
// 启动 daemon（后台拉起）
// v1: 调用 OS 的 service manager（Windows 触发 HKCU Run / macOS launchctl / Linux systemctl）
// v1 简化：直接 spawn 一个新的 bun 进程跑 serve，等价于不带 daemon 安装的启动方式
// ============================================================================
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { logger } from "../utils/logger";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function startDaemon(): Promise<void> {
  const indexPath = join(__dirname, "..", "index.ts");
  const child = spawn("bun", ["run", indexPath, "serve"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  logger.info(`cctra daemon started, pid=${child.pid}`);
}
