// ============================================================================
// cctra serve [--port N]：前台跑 HTTP server
// ============================================================================
import { Command } from "commander";
import { startServer } from "../server/serve";

export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("Run the HTTP server in the foreground")
    .option("-p, --port <port>", "Override port (default from config)")
    .action(async (opts: { port?: string }) => {
      const port = opts.port ? parseInt(opts.port, 10) : undefined;
      const handle = startServer(port);
      console.log(`cctra daemon listening on http://127.0.0.1:${handle.port}`);
      // 不退出
      process.on("SIGINT", () => {
        handle.stop();
        process.exit(0);
      });
      process.on("SIGTERM", () => {
        handle.stop();
        process.exit(0);
      });
      // 永久 hang
      await new Promise(() => {});
    });
}
