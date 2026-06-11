// ============================================================================
// cctra edit <name>：编辑现有 provider 的模型集合（multiselect toggle）
// ============================================================================
import * as p from "@clack/prompts";
import { Command } from "commander";
import { checkCancel } from "../ui/prompts";
import { success, error as errorOut, info } from "../ui/format";
import { withConfig } from "./shared";
import { getProvider, loadConfigFile } from "../core/config";
import { fetchUpstreamModels } from "../core/model-fetch";
import { fetchOpenRouterModels } from "../core/openrouter-models";
import { resolveAutoAlias } from "../core/alias";
import type { Model, Provider } from "../types";

export function registerEdit(program: Command): void {
  program
    .command("edit <name>")
    .description("Edit models on a provider (toggle, add, remove)")
    .action(async (name: string) => {
      try {
        const provider = getProvider(loadConfigFile(), name);
        if (!provider) {
          errorOut(`Provider "${name}" not found.`);
          process.exit(1);
        }
        await editProviderModels(provider);
      } catch (e) {
        if ((e as Error).message.includes("cancelled")) return;
        errorOut((e as Error).message);
        process.exit(1);
      }
    });
}

async function editProviderModels(provider: Provider): Promise<void> {
  const currentIds = new Set(provider.models.map((m) => m.id));

  // 1. 拉上游模型列表
  const s = p.spinner();
  s.start("Fetching model list from upstream...");
  let upstreamModels: string[] = [];
  try {
    upstreamModels = await fetchUpstreamModels({
      endpoint: provider.endpoint,
      token: provider.token,
      apiFormat: provider.apiFormat,
    });
    s.stop(`Found ${upstreamModels.length} model(s).`);
  } catch {
    s.stop("Failed to fetch from upstream.");
  }

  // 2. 上游失败 → 问 fallback
  if (upstreamModels.length === 0) {
    const fallback = checkCancel(
      await p.select<"openrouter" | "manual" | "skip">({
        message: "Upstream fetch failed. Fallback?",
        options: [
          {
            value: "openrouter",
            label: "Try OpenRouter",
            hint: "fetch public model list from openrouter.ai",
          },
          {
            value: "manual",
            label: "Enter manually",
            hint: "comma-separated model IDs",
          },
          {
            value: "skip",
            label: "Skip — only remove current models",
            hint: "multiselect will show current models only",
          },
        ],
      }),
    );

    if (fallback === "openrouter") {
      const s2 = p.spinner();
      s2.start("Fetching from OpenRouter...");
      try {
        upstreamModels = await fetchOpenRouterModels();
        s2.stop(`Found ${upstreamModels.length} model(s).`);
      } catch {
        s2.stop("OpenRouter fetch failed.");
      }
    } else if (fallback === "manual") {
      const manual = checkCancel(
        await p.text({
          message: "Enter model IDs (comma-separated):",
          placeholder: "e.g. deepseek-v4-pro, claude-sonnet-4-6",
        }),
      );
      upstreamModels = manual.split(",").map((s) => s.trim()).filter(Boolean);
    }
    // "skip" => upstreamModels stays empty
  }

  // 3. 合并选项：当前（预勾选 + "(current)"）+ 新候选（未勾选 + "(new)"）
  const options: Array<{ value: string; label: string; hint?: string }> = [];

  // 现有的（全预勾选）
  for (const m of provider.models) {
    options.push({
      value: m.id,
      label: m.id,
      hint: "current",
    });
  }

  // 上游新的（不在当前列表中）
  for (const id of upstreamModels) {
    if (!currentIds.has(id)) {
      options.push({
        value: id,
        label: id,
        hint: "new",
      });
    }
  }

  if (options.length === 0) {
    info("No models to edit. Provider already has no models and no new models were found.");
    return;
  }

  // 4. Multiselect（预选当前 models）
  const selected = checkCancel(
    await p.multiselect({
      message: "Toggle models on this provider (uncheck to remove, check to add):",
      options,
      required: false,
      initialValues: provider.models.map((m) => m.id),
    }),
  ) as string[];

  // 5. 计算 diff
  const removed = provider.models.filter((m) => !selected.includes(m.id));
  const addedIds = selected.filter((id) => !currentIds.has(id));

  // 6. 应用变更
  withConfig((config) => {
    const target = getProvider(config, provider.name);
    if (!target) throw new Error(`Provider "${provider.name}" no longer exists.`);

    // 删
    target.models = target.models.filter((m) => selected.includes(m.id));

    // 加
    const newBatch: Model[] = [...target.models];
    for (const id of addedIds) {
      const alias = resolveAutoAlias(id, config, newBatch, provider.name);
      newBatch.push({ id, alias });
    }
    target.models = newBatch;

    // 有变更才刷新 updatedAt
    if (removed.length > 0 || addedIds.length > 0) {
      target.updatedAt = Date.now();
    }
  });

  const parts: string[] = [];
  if (removed.length > 0) parts.push(`${removed.length} removed`);
  if (addedIds.length > 0) parts.push(`${addedIds.length} added`);
  success(`Provider updated. ${parts.join(", ")}.`);
}
