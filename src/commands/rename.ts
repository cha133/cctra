// ============================================================================
// cctra rename <old> <new>：重命名订阅
// ============================================================================
import { Command } from "commander";
import { withConfig } from "./shared";
import { success, error as errorOut } from "../ui/format";

export function registerRename(program: Command): void {
  program
    .command("rename <old> <new>")
    .description("Rename a subscription")
    .action((oldName: string, newName: string) => {
      try {
        withConfig((config) => {
          const normalized = newName.trim().toLowerCase();
          if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
            throw new Error('New name must be kebab-case: lowercase letters, digits, hyphens.');
          }
          if (!config.subscriptions[oldName]) throw new Error(`Subscription "${oldName}" not found.`);
          if (config.subscriptions[normalized]) throw new Error(`"${normalized}" already exists.`);
          const sub = config.subscriptions[oldName]!;
          sub.name = normalized;
          sub.updatedAt = Date.now();
          config.subscriptions[normalized] = sub;
          delete config.subscriptions[oldName];
        });
        success(`Renamed to "${newName}".`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });
}
