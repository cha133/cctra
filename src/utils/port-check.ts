// ============================================================================
// 端口冲突检测：PID 文件 + try-bind 探针 + 跨平台杀进程
// ----------------------------------------------------------------------------
// 用途：serve 启动前确认 127.0.0.1:<port> 没人占，占了让用户选择杀旧进程。
// 设计：纯函数 + 同步 IO（PID 文件） + 异步 IO（探针、spawn、net.connect）。
// 测试隔离：CCTRA_CONFIG 有值时 servePidFilePath() 返回 null，所有写都跳过。
// ============================================================================
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import * as net from "node:net";
import { join } from "node:path";
import { ensureCctraDir } from "./paths";
import { xdgStateHome } from "./xdg";
import { logger } from "./logger";

export interface PidInfo {
  pid: number;
  port: number;
  startedAt: number;
}

export type KillResult = { ok: true } | { ok: false; reason: string };

// ----------------------------------------------------------------------------
// PID 文件生命周期
// ----------------------------------------------------------------------------

/**
 * PID 文件路径：~/.local/state/cctra/serve.pid。
 *
 * 测试隔离：CCTRA_CONFIG 有值时返回 null——和 v0.7.x 旧契约一致，确保 test 不会
 * 触碰真实 home。如果 test 想真读写 PID 文件（像 port-check.test.ts），应 unset
 * CCTRA_CONFIG 并 backup/restore 这个路径。
 */
export function servePidFilePath(): string | null {
  if (process.env.CCTRA_CONFIG) return null;
  return join(xdgStateHome(), "cctra", "serve.pid");
}

/** 读 PID 文件。任何解析错误都返回 null（视为「无残留」）。 */
export function readPidFile(): PidInfo | null {
  const path = servePidFilePath();
  if (!path) return null;
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  if (!raw.trim()) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;
  const pid = Number(obj.pid);
  const port = Number(obj.port);
  const startedAt = Number(obj.startedAt);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
  return { pid, port, startedAt };
}

/** 原子写 PID 文件：先写 .tmp 再 rename，避免半截文件。 */
export function writePidFile(port: number): void {
  const path = servePidFilePath();
  if (!path) return;
  ensureCctraDir();
  const tmp = `${path}.tmp`;
  const content = JSON.stringify({
    pid: process.pid,
    port,
    startedAt: Date.now(),
  });
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path);
}

/** 同步清 PID 文件。文件不在也无害。给 process.on("exit") 用。 */
export function clearPidFile(): void {
  const path = servePidFilePath();
  if (!path) return;
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // 退出路径上不能抛
  }
}

// ----------------------------------------------------------------------------
// 进程存活 + 杀
// ----------------------------------------------------------------------------

/** process.kill(pid, 0) 探活。ESRCH = 死了，EPERM = 活着但无权限信号它。 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true; // 进程存在，只是我们没权限
    return false;
  }
}

/** 跨平台杀进程。Windows 用 taskkill /F，POSIX 用 SIGTERM → SIGKILL。 */
export async function killProcess(pid: number): Promise<KillResult> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { ok: false, reason: `invalid pid: ${pid}` };
  }
  if (process.platform === "win32") return killProcessWindows(pid);
  return killProcessPosix(pid);
}

async function killProcessWindows(pid: number): Promise<KillResult> {
  try {
    const proc = Bun.spawn(["taskkill", "/F", "/PID", String(pid)], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    if (code === 0) return { ok: true };
    const stderr = await new Response(proc.stderr).text();
    return { ok: false, reason: stderr.trim() || `taskkill exited with code ${code}` };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? String(e) };
  }
}

async function killProcessPosix(pid: number): Promise<KillResult> {
  // 第一步：SIGTERM，留 1s 给进程优雅退出
  try {
    process.kill(pid, "SIGTERM");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return { ok: true }; // 已经死了
    return { ok: false, reason: (e as Error)?.message ?? String(e) };
  }
  if (await waitForExit(pid, 1000)) return { ok: true };

  // 第二步：SIGKILL
  try {
    process.kill(pid, "SIGKILL");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return { ok: true };
    return { ok: false, reason: (e as Error)?.message ?? String(e) };
  }
  if (await waitForExit(pid, 1000)) return { ok: true };
  return { ok: false, reason: `pid ${pid} did not exit after SIGKILL` };
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return true;
    await Bun.sleep(100);
  }
  return false;
}

// ----------------------------------------------------------------------------
// 端口占用探针
// ----------------------------------------------------------------------------

/**
 * 127.0.0.1:<port> 是否被占。
 * 实现：TCP connect 探针。Bun.serve 在 Windows 上默认开 SO_REUSEPORT，
 * 会让两个进程同时绑同一端口、server.port 仍返回 3133，silent rebind
 * 假设不成立。用 TCP connect 探测可绕过 SO_REUSEPORT —— 只要有进程在
 * listen，三次握手就成功，connect 返回。
 */
export async function isPortBusy(port: number): Promise<boolean> {
  return !(await isTcpPortFree(port));
}

/** 轮询 127.0.0.1:<port>，直到没人监听或超时。默认 5s / 100ms 间隔。 */
export async function waitForPortFree(port: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isTcpPortFree(port)) return true;
    await Bun.sleep(100);
  }
  return false;
}

function isTcpPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (free: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(free);
    };
    // ECONNREFUSED = 没人监听 = 端口空闲
    // connect 成功 = 有人监听 = 端口忙
    // 其它错误（timeout/ENETUNREACH 等）保守视为空闲
    socket.setTimeout(300);
    socket.once("connect", () => finish(false));
    socket.once("timeout", () => finish(true));
    socket.once("error", () => finish(true));
    socket.connect(port, "127.0.0.1");
  });
}

// ----------------------------------------------------------------------------
// 占用方 PID 反查（用于「非 cctra 占 3133」场景）
// ----------------------------------------------------------------------------

/** 跨平台查 127.0.0.1:<port> 的 LISTEN 占用方 PID。失败/找不到 → null。 */
export async function findListeningPid(port: number): Promise<number | null> {
  if (port <= 0 || port > 65535) return null;
  if (process.platform === "win32") {
    const ps = await findListeningPidPowerShell(port);
    if (ps !== null) return ps;
    // PowerShell 不可用时回落 netstat（带本地化表头容错）
    return findListeningPidNetstat(port);
  }
  return findListeningPidLsof(port);
}

async function findListeningPidPowerShell(port: number): Promise<number | null> {
  const script =
    `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue ` +
    `| Select-Object -First 1 -ExpandProperty OwningProcess) -as [string]`;
  try {
    const proc = Bun.spawn(
      ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
      { stdout: "pipe", stderr: "pipe" },
    );
    const settled = await Promise.race([proc.exited, Bun.sleep(2000).then(() => "timeout")]);
    if (settled === "timeout") {
      proc.kill();
      return null;
    }
    const code = settled as number;
    if (code !== 0) return null;
    const stdout = await new Response(proc.stdout).text();
    const pid = parseInt(stdout.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (e) {
    logger.debug(`findListeningPid PowerShell failed: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

async function findListeningPidNetstat(port: number): Promise<number | null> {
  // 行格式（本地化表头，列顺序固定）："  TCP    0.0.0.0:3133    0.0.0.0:0    LISTENING    1234"
  // 或 "  TCP    [::]:3133    [::]:0    LISTENING    1234"（IPv6）
  // 不依赖表头，直接匹配 TCP 行 + LISTENING + 端口号
  try {
    const proc = Bun.spawn(["netstat", "-ano", "-p", "TCP"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const settled = await Promise.race([proc.exited, Bun.sleep(2000).then(() => "timeout")]);
    if (settled === "timeout") {
      proc.kill();
      return null;
    }
    if ((settled as number) !== 0) return null;
    const stdout = await new Response(proc.stdout).text();
    // 匹配任意地址（IPv4 / IPv6）+ 目标端口 + LISTENING + PID
    const re = new RegExp(
      `\\sTCP\\s+\\S+[:\\]]${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`,
      "im",
    );
    const match = stdout.match(re);
    if (!match || !match[1]) return null;
    const pid = parseInt(match[1], 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (e) {
    logger.debug(`findListeningPid netstat failed: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

async function findListeningPidLsof(port: number): Promise<number | null> {
  // -F p 输出每进程一行 "p<pid>"，比表格解析稳
  try {
    const proc = Bun.spawn(
      ["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "p"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const settled = await Promise.race([proc.exited, Bun.sleep(2000).then(() => "timeout")]);
    if (settled === "timeout") {
      proc.kill();
      return null;
    }
    if ((settled as number) !== 0) return null;
    const stdout = await new Response(proc.stdout).text();
    const match = stdout.match(/^p(\d+)/m);
    if (!match || !match[1]) return null;
    const pid = parseInt(match[1], 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (e) {
    // lsof 不在 PATH 时 spawn 抛 ENOENT，视为「无法定位」
    logger.debug(`findListeningPid lsof failed: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

// ----------------------------------------------------------------------------
// 工具：相对时间（用于提示 "started 5 min ago"）
// ----------------------------------------------------------------------------

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return `${Math.floor(diff / 86_400_000)} d ago`;
}
