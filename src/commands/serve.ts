// ============================================================================
// cctra serve [--port N] [--force] [--no-port-check]：前台跑 HTTP server
// ----------------------------------------------------------------------------
// 启动顺序：解析端口 → 决定是否检测 → probePort → 分类占用方 →
//   TTY 询问 / --force 静默杀 / 非 TTY 报错 → kill → waitForPortFree →
//   startServer → writePidFile → 注册清理钩子（SIGINT/SIGTERM/exit/异常）
//
// 端口冲突逻辑全部在本文件；src/server/serve.ts 保持干净，
// tests/server.test.ts 直接调 startServer() 仍照过（CCTRA_CONFIG 隔离）。
// ============================================================================
import { Command } from "commander";
import { startServer } from "../server/serve";
import { loadConfigFile } from "../core/config";
import {
  clearPidFile,
  findListeningPid,
  formatRelativeTime,
  isPidAlive,
  isPortBusy,
  killProcess,
  readPidFile,
  waitForPortFree,
  writePidFile,
} from "../utils/port-check";
import { confirm } from "../ui/prompts";
import { error, warn } from "../ui/format";
import { logger } from "../utils/logger";

interface ServeOptions {
  port?: string;
  force?: boolean;
  portCheck?: boolean;
}

export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("Run the HTTP server in the foreground")
    .option("-p, --port <port>", "Override port (default from config)")
    .option("--force", "Kill anything on the target port without prompting", false)
    .option("--no-port-check", "Skip port-conflict check (legacy silent-rebind behavior)")
    .action(async (opts: ServeOptions) => {
      const overridePort = opts.port ? parseInt(opts.port, 10) : undefined;
      if (
        overridePort !== undefined &&
        (!Number.isInteger(overridePort) || overridePort < 1 || overridePort > 65535)
      ) {
        error(`Invalid --port value: ${opts.port}`);
        process.exit(2);
      }
      const config = loadConfigFile();
      const port = overridePort ?? config.port;

      // 1. 是否检测：CCTRA_CONFIG 模式下跳过（tests/server.test.ts 隔离约定）
      const skipCheck = opts.portCheck === false;
      const testMode = process.env.CCTRA_CONFIG !== undefined;

      if (skipCheck) {
        logger.info("--no-port-check set; skipping port conflict check");
        startAndInstallCleanup(port);
        await hangForever();
        return;
      }

      if (!testMode) {
        // 2. 探针（TCP connect，绕过 SO_REUSEPORT）
        const busy = await isPortBusy(port);
        if (!busy) {
          startAndInstallCleanup(port);
          await hangForever();
          return;
        }

        // 3. 端口被占 → 分类占用方
        const owner = await classifyOwner(port);

        // 4. 决定怎么继续
        const proceed = await resolveConflict(port, owner, opts.force ?? false);
        if (!proceed) {
          error(
            "Aborted. Use --force to kill without prompting, or --no-port-check to silently rebind.",
          );
          process.exit(1);
        }

        // 5. 杀（unknown 分支已在 resolveConflict 里被拒，到这里 owner 必有 pid）
        if (owner.kind !== "unknown") {
          warn(`Killing PID ${owner.pid} to free port ${port}...`);
          const result = await killProcess(owner.pid);
          if (!result.ok) {
            error(`Failed to kill PID ${owner.pid}: ${result.reason}`);
            process.exit(1);
          }
        }

        // 6. 等端口释放
        const freed = await waitForPortFree(port, 5000);
        if (!freed) {
          if (owner.kind !== "unknown") {
            error(
              `Killed PID ${owner.pid} but port ${port} is still busy after 5s. ` +
                `Another process may have taken it.`,
            );
          } else {
            error(`Port ${port} is still busy. The owner could not be identified.`);
          }
          process.exit(1);
        }
      }

      // 7. 启动
      startAndInstallCleanup(port);
      await hangForever();
    });
}

// ----------------------------------------------------------------------------
// 占用方分类
// ----------------------------------------------------------------------------

type OwnerInfo =
  | { kind: "cctra"; pid: number; startedAt: number }
  | { kind: "foreign"; pid: number }
  | { kind: "unknown" };

async function classifyOwner(port: number): Promise<OwnerInfo> {
  // 优先 PID 文件（精确识别旧 cctra）
  const pidFile = readPidFile();
  if (pidFile && pidFile.port === port && isPidAlive(pidFile.pid)) {
    return { kind: "cctra", pid: pidFile.pid, startedAt: pidFile.startedAt };
  }
  // 兜底：netstat / lsof 查（任意进程）
  const pid = await findListeningPid(port);
  if (pid !== null) {
    return { kind: "foreign", pid };
  }
  return { kind: "unknown" };
}

// ----------------------------------------------------------------------------
// 冲突解决：TTY 询问 / --force / 非 TTY 报错 / unknown 直接拒
// ----------------------------------------------------------------------------

async function resolveConflict(
  port: number,
  owner: OwnerInfo,
  force: boolean,
): Promise<boolean> {
  if (owner.kind === "unknown") {
    error(
      `Port ${port} is in use, but the owning process could not be identified ` +
        `(netstat/lsof parsing failed). Stop the conflicting service manually, ` +
        `or re-run with --no-port-check to silently rebind.`,
    );
    return false;
  }

  if (force) {
    logger.info(`--force set; will kill PID ${owner.pid} to free port ${port}`);
    return true;
  }

  if (!process.stdin.isTTY) {
    const who = owner.kind === "cctra" ? "cctra" : "another process";
    error(
      `Port ${port} is in use by ${who} (PID ${owner.pid}). ` +
        `Re-run with --force to kill it, or --no-port-check to silently rebind.`,
    );
    return false;
  }

  // TTY 询问
  warn(
    `Port ${port} is in use${owner.kind === "cctra" ? " by another cctra instance" : ""}.`,
  );
  const message =
    owner.kind === "cctra"
      ? `Kill the existing cctra (PID ${owner.pid}, started ${formatRelativeTime(
          owner.startedAt,
        )}) and take port ${port}?`
      : `Port ${port} is held by another process (PID ${owner.pid}). Kill it and take the port?`;
  return await confirm(message, false);
}

// ----------------------------------------------------------------------------
// 启动 + 清理钩子
// ----------------------------------------------------------------------------

function startAndInstallCleanup(port: number): void {
  const handle = startServer(port);
  writePidFile(handle.port);

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    clearPidFile();
    try {
      handle.stop();
    } catch {
      // ignore
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  // exit 钩子是同步保险（上面两个 handler 调 process.exit 时会顺带触发）
  process.on("exit", () => {
    clearPidFile();
  });
  // 异常路径上不能依赖 exit 钩子被触发（少数情况下进程被强制 kill），
  // 显式清一次以防残留
  process.on("uncaughtException", (e) => {
    clearPidFile();
    logger.error(`uncaughtException: ${(e as Error)?.stack ?? e}`);
    process.exit(1);
  });
  process.on("unhandledRejection", (e) => {
    clearPidFile();
    logger.error(`unhandledRejection: ${(e as Error)?.stack ?? e}`);
    process.exit(1);
  });
}

function hangForever(): Promise<never> {
  return new Promise(() => {});
}
