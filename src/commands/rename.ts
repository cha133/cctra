// ============================================================================
// cctra rename <old> <new>：重命名 provider
// ============================================================================
import { Command } from "commander";
import { withConfig } from "./shared";
import { success, error as errorOut } from "../ui/format";

export function registerRename(program: Command): void {
  program
    .command("rename <old> <new>")
    .description("Rename a provider")
    .action((oldName: string, newName: string) => {
      try {
        withConfig((config) => {
          const normalized = newName.trim().toLowerCase();
          if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
            throw new Error('New name must be kebab-case: lowercase letters, digits, hyphens.');
          }
          if (!config.providers[oldName]) throw new Error(`Provider "${oldName}" not found.`);
          if (config.providers[normalized]) throw new Error(`"${normalized}" already exists.`);
          const provider = config.providers[oldName]!;
          provider.name = normalized;
          provider.updatedAt = Date.now();
          config.providers[normalized] = provider;
          delete config.providers[oldName];
        });
        success(`Renamed to "${newName}".`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });
}
