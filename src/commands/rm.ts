// ============================================================================
// cctra rm <name>：删除 provider / 插件 / model（自动检测）
// ============================================================================
import { Command } from "commander";
import * as p from "@clack/prompts";
import { withConfig } from "./shared";
import { removeProvider, removePlugin } from "../core/config";
import { resolveModelRef } from "../core/resolve";
import { getSource } from "../core/source";
import { checkCancel } from "../ui/prompts";
import { success, error as errorOut } from "../ui/format";
import type { Config } from "../types";

export function registerRm(program: Command): void {
  program
    .command("rm <name>")
    .alias("remove")
    .description("Remove a provider, plugin, or model")
    .action(async (name: string) => {
      try {
        withConfig((config) => {
          // 1. 含 / → provider/model 格式
          if (name.includes("/")) {
            removeModelByName(name, config);
            return;
          }

          // 2. 尝试全局 alias 唯一解析 → model
          let resolved: { sourceName: string; modelId: string } | null = null;
          try {
            const r = resolveModelRef(name, config);
            if (r) resolved = { sourceName: r.source.name, modelId: r.modelId };
          } catch {
            // 歧义 — 当作 provider/plugin 名处理，不报错
          }
          if (resolved) {
            removeModel(name, resolved.sourceName, resolved.modelId, config);
            return;
          }

          // 3. 回退：provider / plugin
          removeSource(name, config);
        });
      } catch (e) {
        if ((e as Error).message.includes("cancelled")) return;
        errorOut((e as Error).message);
        process.exit(1);
      }
    });
}

async function confirmRemoveModel(ref: string, providerName: string): Promise<boolean> {
  return checkCancel(
    await p.confirm({
      message: `Remove model "${ref}" from "${providerName}"?`,
      initialValue: false,
    }),
  );
}

async function confirmRemoveSource(name: string): Promise<boolean> {
  return checkCancel(
    await p.confirm({
      message: `Delete "${name}"?`,
      initialValue: false,
    }),
  );
}

function removeModelByName(ref: string, config: Config): void {
  const [sourceName, modelPart] = ref.split("/", 2);
  if (!sourceName || !modelPart) throw new Error(`Invalid model reference: "${ref}"`);

  const source = getSource(config, sourceName);
  if (!source) throw new Error(`Provider "${sourceName}" not found.`);

  const idx = source.models.findIndex((m) => m.id === modelPart || m.alias === modelPart);
  if (idx < 0) throw new Error(`Model "${modelPart}" not found in "${sourceName}".`);

  source.models.splice(idx, 1);
  success(`Removed model "${ref}".`);
}

async function removeModel(ref: string, sourceName: string, modelId: string, config: Config): Promise<void> {
  const ok = await confirmRemoveModel(ref, sourceName);
  if (!ok) throw new Error("cancelled");

  const source = getSource(config, sourceName);
  if (!source) throw new Error(`Provider "${sourceName}" not found.`);

  const idx = source.models.findIndex((m) => m.id === modelId);
  if (idx < 0) throw new Error(`Model "${modelId}" not found in "${sourceName}".`);

  source.models.splice(idx, 1);
  success(`Removed model "${ref}".`);
}

async function removeSource(name: string, config: Config): Promise<void> {
  const ok = await confirmRemoveSource(name);
  if (!ok) throw new Error("cancelled");

  if (config.providers[name]) {
    removeProvider(config, name);
    success(`Removed provider "${name}".`);
  } else if (config.plugins[name]) {
    removePlugin(config, name);
    success(`Removed plugin "${name}".`);
  } else {
    throw new Error(`Not found: "${name}". Use \`provider/model\` format to remove a model.`);
  }
}
