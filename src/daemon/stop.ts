// ============================================================================
// 停止 daemon：探测端口占用进程并 kill
// ============================================================================
import { execSync } from "node:child_process";
import { logger } from "../utils/logger";

export async function stopDaemon(): Promise<void> {
  if (process.platform === "win32") {
    // PowerShell 找占用 3133 端口的进程
    try {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 3133 -State Listen -ErrorAction SilentlyContinue).OwningProcess"`,
        { stdio: "pipe" },
      ).toString();
      const pids = out.split("\n").map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
      for (const pid of pids) {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "pipe" });
        logger.info(`[stop] killed pid ${pid}`);
      }
    } catch (e) {
      logger.warn(`[stop] failed: ${(e as Error).message}`);
    }
  } else {
    // macOS / Linux：lsof 找 pid
    try {
      const out = execSync(`lsof -ti :3133`, { stdio: "pipe" }).toString();
      const pids = out.split("\n").map((s) => s.trim()).filter(Boolean);
      for (const pid of pids) {
        execSync(`kill -TERM ${pid}`, { stdio: "pipe" });
        logger.info(`[stop] killed pid ${pid}`);
      }
    } catch (e) {
      logger.warn(`[stop] failed: ${(e as Error).message}`);
    }
  }
}
