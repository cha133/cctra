// ============================================================================
// cctra rm <name>：删除订阅或插件
// ============================================================================
import { Command } from "commander";
import * as p from "@clack/prompts";
import { withConfig } from "./shared";
import { removeSubscription, removePlugin } from "../core/config";
import { checkCancel } from "../ui/prompts";
import { success, error as errorOut } from "../ui/format";

export function registerRm(program: Command): void {
  program
    .command("rm <name>")
    .alias("remove")
    .description("Remove a subscription or plugin")
    .action(async (name: string) => {
      try {
        const ok = checkCancel(
          await p.confirm({
            message: `Delete "${name}"?`,
            initialValue: false,
          }),
        );
        if (!ok) return;

        withConfig((config) => {
          if (config.subscriptions[name]) removeSubscription(config, name);
          else if (config.plugins[name]) removePlugin(config, name);
          else throw new Error(`Not found: "${name}"`);
        });
        success(`Removed "${name}".`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });
}
