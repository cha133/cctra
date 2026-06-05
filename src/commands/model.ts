// ============================================================================
// cctra model <subcommand>：管理订阅的模型
// add / ls / rm / rename
// ============================================================================
import { Command } from "commander";
import * as p from "@clack/prompts";
import { withConfig } from "./shared";
import { checkCancel } from "../ui/prompts";
import { success, error as errorOut } from "../ui/format";

export function registerModel(program: Command): void {
  const model = program.command("model").description("Manage models in a subscription");

  // cctra model add <sub>
  model
    .command("add <sub>")
    .description("Add a model to a subscription")
    .action(async (sub: string) => {
      try {
        const id = checkCancel(await p.text({ message: "Model ID (upstream):", validate: (v) => !v?.trim() ? "Required" : undefined }));
        const aliasRaw = checkCancel(await p.text({ message: "Alias (optional):", defaultValue: "" }));
        const alias = aliasRaw.trim() || undefined;
        withConfig((config) => {
          if (!config.subscriptions[sub]) throw new Error(`Subscription "${sub}" not found.`);
          const s = config.subscriptions[sub]!;
          if (s.models.find((m) => m.id === id)) throw new Error(`Model "${id}" already exists.`);
          s.models.push({ id, alias });
          s.updatedAt = Date.now();
        });
        success(`Added model "${id}".`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });

  // cctra model ls <sub>
  model
    .command("ls <sub>")
    .description("List models in a subscription")
    .action((sub: string) => {
      withConfig((config) => {
        if (!config.subscriptions[sub]) {
          errorOut(`Subscription "${sub}" not found.`);
          return;
        }
        for (const m of config.subscriptions[sub]!.models) {
          const alias = m.alias ? ` (alias: ${m.alias})` : "";
          console.log(`- ${m.id}${alias}`);
        }
      });
    });

  // cctra model rm <sub> <id-or-alias>
  model
    .command("rm <sub> <model>")
    .description("Remove a model from a subscription")
    .action((sub: string, model: string) => {
      try {
        withConfig((config) => {
          if (!config.subscriptions[sub]) throw new Error(`Subscription "${sub}" not found.`);
          const s = config.subscriptions[sub]!;
          const idx = s.models.findIndex((m) => m.id === model || m.alias === model);
          if (idx < 0) throw new Error(`Model "${model}" not found.`);
          s.models.splice(idx, 1);
          s.updatedAt = Date.now();
        });
        success(`Removed model "${model}".`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });

  // cctra model rename <sub> <model> <new-alias>
  model
    .command("rename <sub> <model> <newAlias>")
    .description("Set/change alias of a model")
    .action((sub: string, model: string, newAlias: string) => {
      try {
        withConfig((config) => {
          if (!config.subscriptions[sub]) throw new Error(`Subscription "${sub}" not found.`);
          const s = config.subscriptions[sub]!;
          const m = s.models.find((m) => m.id === model || m.alias === model);
          if (!m) throw new Error(`Model "${model}" not found.`);
          m.alias = newAlias.trim() || undefined;
          s.updatedAt = Date.now();
        });
        success(`Updated alias.`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });
}
