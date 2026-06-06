// ============================================================================
// 停止 daemon：探测端口占用进程并 kill
// 端口从 config 读，与 serve 时绑定的端口保持一致
// ============================================================================
import { execSync } from "node:child_process";
import { loadConfigFile } from "../core/config";
import { logger } from "../utils/logger";

export async function stopDaemon(): Promise<void> {
  const port = loadConfigFile().port;

  if (process.platform === "win32") {
    // PowerShell 找占用 config.port 端口的进程
    // -ErrorAction SilentlyContinue + 0 长度 = 找不到监听时 stdout 为空，exit 0
    const out = execSync(
      `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue).OwningProcess"`,
      { stdio: "pipe" },
    ).toString();
    const pids = Array.from(new Set(
      out.split("\n").map((s) => s.trim()).filter((s) => /^\d+$/.test(s)),
    ));
    if (pids.length === 0) {
      throw new Error(`No process is listening on port ${port} (daemon not running?)`);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "pipe" });
        logger.info(`[stop] killed pid ${pid}`);
      } catch (e) {
        throw new Error(`taskkill /F /PID ${pid} failed: ${(e as Error).message}`);
      }
    }
    return;
  }

  // macOS / Linux：lsof 找 pid
  let out: string;
  try {
    out = execSync(`lsof -ti :${port}`, { stdio: "pipe" }).toString();
  } catch {
    // lsof 找不到监听时 exit 1、stdout 为空
    throw new Error(`No process is listening on port ${port} (daemon not running?)`);
  }
  const pids = Array.from(new Set(
    out.split("\n").map((s) => s.trim()).filter((s) => /^\d+$/.test(s)),
  ));
  if (pids.length === 0) {
    throw new Error(`No process is listening on port ${port} (daemon not running?)`);
  }
  for (const pid of pids) {
    try {
      execSync(`kill -TERM ${pid}`, { stdio: "pipe" });
      logger.info(`[stop] killed pid ${pid}`);
    } catch (e) {
      throw new Error(`kill -TERM ${pid} failed: ${(e as Error).message}`);
    }
  }
}
