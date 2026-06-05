// ============================================================================
// cctra daemon <subcommand>：守护进程管理
// install / uninstall / start / stop / status
// ============================================================================
import { Command } from "commander";
import { install, uninstall, isInstalled } from "../daemon/install";
import { checkDaemonStatus } from "../daemon/status";
import { startDaemon } from "../daemon/start";
import { stopDaemon } from "../daemon/stop";
import { success, error as errorOut, info, dim, green, red } from "../ui/format";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ENTRYPOINT = join(__dirname, "..", "index.ts");

export function registerDaemon(program: Command): void {
  const daemon = program.command("daemon").description("Manage the cctra daemon");

  // cctra daemon install
  daemon
    .command("install")
    .description("Install daemon as a system startup item")
    .action(() => {
      try {
        const bundledLauncher = process.platform === "win32"
          ? join(__dirname, "..", "..", "bin", "cctra-daemon.exe")
          : undefined;
        if (process.platform === "win32" && (!bundledLauncher || !existsSync(bundledLauncher))) {
          errorOut(`Bundled launcher not found: ${bundledLauncher}`);
          errorOut("Build it first with scripts/build-launcher.ps1");
          return;
        }
        install({ bundledLauncherPath: bundledLauncher, daemonEntrypoint: DAEMON_ENTRYPOINT });
        success(`Installed cctra daemon for ${process.platform}.`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });

  // cctra daemon uninstall
  daemon
    .command("uninstall")
    .description("Remove daemon from system startup")
    .action(() => {
      try {
        uninstall();
        success(`Uninstalled cctra daemon.`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });

  // cctra daemon start
  daemon
    .command("start")
    .description("Start the daemon (background)")
    .action(async () => {
      try {
        await startDaemon();
        success(`Started.`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });

  // cctra daemon stop
  daemon
    .command("stop")
    .description("Stop the daemon")
    .action(async () => {
      try {
        await stopDaemon();
        success(`Stopped.`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });

  // cctra daemon status
  daemon
    .command("status")
    .description("Check daemon status")
    .action(async () => {
      const status = await checkDaemonStatus();
      const installed = isInstalled();
      const runningIcon = status.running ? green("✓ running") : red("✗ not running");
      const installedIcon = installed ? green("✓ installed") : red("✗ not installed");
      console.log(`Daemon:    ${runningIcon}`);
      console.log(`Startup:   ${installedIcon}`);
      console.log(`Port:      ${status.port}`);
      console.log(dim(`Health:    http://127.0.0.1:${status.port}/healthz`));
      if (!status.running && !installed) {
        info(`Run \`cctra daemon install\` to register as a startup item, or \`cctra serve\` to run in foreground.`);
      }
    });
}
