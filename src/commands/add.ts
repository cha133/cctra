// ============================================================================
// cctra add：交互式添加订阅
// ============================================================================
import * as p from "@clack/prompts";
import { Command } from "commander";
import { checkCancel } from "../ui/prompts";
import { success, error as errorOut, info } from "../ui/format";
import { withConfig } from "./shared";
import { addSubscription, loadConfigFile } from "../core/config";
import { fetchUpstreamModels } from "../core/model-fetch";
import { resolveAutoAlias } from "../core/alias";
import {
  API_FORMAT_LABELS,
  getEndpointForFormat,
  getPresetHint,
  getSupportedApiFormats,
  getVendorChoices,
  generateProfileName,
  NO_VENDOR,
  type ProviderPreset,
} from "../providers/presets";
import type { Subscription, ApiFormat, Model } from "../types";

export function registerAdd(program: Command): void {
  program
    .command("add")
    .description("Interactively add a subscription")
    .action(async () => {
      try {
        const sub = await promptNewSubscription();
        withConfig((config) => addSubscription(config, sub));
        success(`Added subscription "${sub.name}" with ${sub.models.length} model(s).`);
        info(`Run \`cctra serve\` to start the server.`);
      } catch (e) {
        if ((e as Error).message.includes("cancelled")) return;
        errorOut((e as Error).message);
        process.exit(1);
      }
    });
}

async function promptNewSubscription(): Promise<Subscription> {
  // 1. Vendor（可跳过 → 走纯手输）
  const vendor = checkCancel(
    await p.autocomplete<ProviderPreset>({
      message: "Select a vendor (type to search, or pick '(不使用供应商)' for custom):",
      options: getVendorChoices().map((v) => ({
        value: v,
        label: v.name,
        hint: getPresetHint(v),
      })),
      placeholder: "Type to filter vendors...",
    }),
  );
  const isCustom = vendor.name === NO_VENDOR.name;

  // 2. 名称（vendor 选中时自动从 vendor.name 生成）
  const defaultName = isCustom ? "" : generateProfileName(vendor.name);
  const name = checkCancel(
    await p.text({
      message: "Subscription name:",
      initialValue: defaultName,
      placeholder: "e.g. ark-agent-plan, deepseek",
      validate: (v) => {
        if (!v?.trim()) return "Name is required.";
        const n = v.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]*$/.test(n)) return 'Use kebab-case: lowercase letters, digits, hyphens.';
        return undefined;
      },
    }),
  );

  // 3. 协议（vendor 选中时只显示该 preset 支持的协议）
  const supportedFormats = getSupportedApiFormats(vendor);
  const apiFormat = checkCancel(
    await p.select<ApiFormat>({
      message: "Upstream API format:",
      initialValue: supportedFormats[0],
      options: supportedFormats.map((format) => ({
        value: format,
        label: API_FORMAT_LABELS[format],
      })),
    }),
  );

  // 4. Endpoint（vendor 选中时按协议预填）
  const endpoint = checkCancel(
    await p.text({
      message: "Endpoint URL (root, no /v1 suffix):",
      initialValue: getEndpointForFormat(vendor, apiFormat),
      placeholder: "e.g. https://ark.cn-beijing.volces.com/api/plan",
      validate: (v) => (!v?.trim() ? "Endpoint is required." : undefined),
    }),
  );

  // 4.5 提示 vendor 备注（如有）
  if (vendor.notes && !isCustom) {
    info(`Note: ${vendor.notes}`);
  }

  // 5. Token
  const token = checkCancel(
    await p.password({
      message: "API key / token:",
      validate: (v) => (!v?.trim() ? "Token is required." : undefined),
    }),
  );

  // 6. 拉模型列表
  const s = p.spinner();
  s.start("Fetching model list from upstream...");
  let modelNames: string[] = [];
  try {
    modelNames = await fetchUpstreamModels({
      endpoint: endpoint.trim(),
      token: token.trim(),
      apiFormat,
    });
    s.stop(`Found ${modelNames.length} model(s).`);
  } catch {
    s.stop("Failed to fetch models, will add manually.");
  }

  // 7. 选模型
  let selected: string[] = [];
  if (modelNames.length > 0) {
    const result = checkCancel(
      await p.multiselect({
        message: "Select models to add:",
        options: modelNames.map((m) => ({ value: m, label: m })),
        required: false,
      }),
    );
    selected = result as string[];
  }

  if (selected.length === 0) {
    // 手动输入
    const manual = checkCancel(
      await p.text({
        message: "Enter model IDs (comma-separated):",
        placeholder: "e.g. deepseek-v4-pro, claude-sonnet-4-6",
      }),
    );
    selected = manual.split(",").map((s) => s.trim()).filter(Boolean);
  }

  return {
    kind: "subscription",
    vendor: isCustom ? undefined : vendor.name,
    name: name.trim().toLowerCase(),
    endpoint: endpoint.trim(),
    token: token.trim(),
    apiFormat,
    ...(apiFormat === "openai-responses" ? { responsesPath: "/v1/responses" } : {}),
    models: autoAliasModels(selected),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * 给一批 model id 算 alias：
 *   - 全局（含本批）唯一 → alias = id
 *   - 冲突 → alias = undefined
 * 用户的 config 已存在，subscription 还没插入，所以其他 source 都算「占用」。
 */
function autoAliasModels(ids: string[]): Model[] {
  const config = loadConfigFile();
  const batch: Model[] = [];
  return ids.map((id) => {
    const alias = resolveAutoAlias(id, config, batch);
    const m: Model = alias ? { id, alias } : { id };
    batch.push(m);
    return m;
  });
}
