// ============================================================================
// cctra tier <subcommand>：管理 tier 映射
// set / ls / show / rm
// ============================================================================
import { Command } from "commander";
import { withConfig } from "./shared";
import { success, error as errorOut, info, dim, bold } from "../ui/format";
import { setTier, removeTier } from "../core/config";
import { BUILTIN_TIERS } from "../types";

export function registerTier(program: Command): void {
  const tier = program.command("tier").description("Manage tier model mappings");

  // cctra tier set <name> <target>
  tier
    .command("set <name> <target>")
    .description("Set/update a tier mapping (e.g. `cctra tier set cctra-pro my-sub/model-x`)")
    .action((name: string, target: string) => {
      try {
        withConfig((config) => {
          setTier(config, { name, target, description: config.tiers[name]?.description });
        });
        success(`Mapped ${name} → ${target}.`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });

  // cctra tier ls
  tier
    .command("ls")
    .description("List all tier mappings")
    .action(() => {
      withConfig((config) => {
        const all = Object.values(config.tiers);
        const builtinSet = new Set<string>(BUILTIN_TIERS);
        const builtin = all.filter((t) => builtinSet.has(t.name));
        const custom = all.filter((t) => !builtinSet.has(t.name));

        console.log(bold("Built-in tiers:"));
        for (const t of builtin) {
          const target = t.target || dim("(not mapped)");
          console.log(`  ${t.name.padEnd(15)} → ${target}  ${dim(t.description ?? "")}`);
        }

        if (custom.length > 0) {
          console.log("");
          console.log(bold("Custom tiers:"));
          for (const t of custom) {
            const target = t.target || dim("(not mapped)");
            console.log(`  ${t.name.padEnd(15)} → ${target}  ${dim(t.description ?? "")}`);
          }
        }

        if (builtin.length + custom.length === 0) {
          info("No tiers configured.");
        }
      });
    });

  // cctra tier show <name>
  tier
    .command("show <name>")
    .description("Show a tier's current target")
    .action((name: string) => {
      withConfig((config) => {
        const t = config.tiers[name];
        if (!t) { errorOut(`Tier "${name}" not found.`); return; }
        const target = t.target || dim("(not mapped)");
        console.log(`${name} → ${target}`);
        if (t.description) console.log(dim(t.description));
      });
    });

  // cctra tier rm <name>
  tier
    .command("rm <name>")
    .description("Unmap a tier (built-ins keep the name, just clear target)")
    .action((name: string) => {
      try {
        withConfig((config) => {
          removeTier(config, name);
        });
        success(`Unmapped ${name}.`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });
}
