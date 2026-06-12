// ============================================================================
// cctra rename <old> <new>：重命名 provider，并同步改 aliases value 的 prefix
// ============================================================================
import { Command } from "commander";
import { withConfig } from "./shared";
import { success, error as errorOut } from "../ui/format";
import { describeNameOwner, isValidAliasName, nameTakenAnywhere } from "../core/namespace";

export function registerRename(program: Command): void {
  program
    .command("rename <old> <new>")
    .description("Rename a provider")
    .action((oldName: string, newName: string) => {
      try {
        withConfig((config) => {
          const normalized = newName.trim().toLowerCase();
          if (!isValidAliasName(normalized)) {
            throw new Error(
              "New name must be kebab-case (lowercase letters, digits, hyphens; 1-63 chars).",
            );
          }
          if (!config.providers[oldName]) {
            throw new Error(`Provider "${oldName}" not found.`);
          }
          if (normalized !== oldName && nameTakenAnywhere(config, normalized)) {
            const owner = describeNameOwner(config, normalized);
            throw new Error(`Name "${normalized}" is already in use as ${owner}.`);
          }

          const provider = config.providers[oldName]!;
          provider.name = normalized;
          provider.updatedAt = Date.now();
          config.providers[normalized] = provider;
          if (normalized !== oldName) delete config.providers[oldName];

          // 同步改 aliases value 的 prefix
          if (normalized !== oldName) {
            const oldPrefix = `${oldName}/`;
            const newPrefix = `${normalized}/`;
            for (const [aname, val] of Object.entries(config.aliases)) {
              if (val.startsWith(oldPrefix)) {
                config.aliases[aname] = newPrefix + val.slice(oldPrefix.length);
              }
            }
          }
        });
        success(`Renamed to "${newName}".`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });
}
