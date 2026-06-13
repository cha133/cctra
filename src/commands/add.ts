// ============================================================================
// cctra add：交互式添加 provider
// ============================================================================
import * as p from "@clack/prompts";
import { Command } from "commander";
import { checkCancel } from "../ui/prompts";
import { success, error as errorOut, info } from "../ui/format";
import { withConfig } from "./shared";
import { addProvider } from "../core/config";
import { fetchUpstreamModels } from "../core/model-fetch";
import { autoAliasValue } from "../core/alias";
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
import type { Provider, ApiFormat, Config } from "../types";

export function registerAdd(program: Command): void {
  program
    .command("add")
    .description("Interactively add a provider")
    .action(async () => {
      try {
        const provider = await promptNewProvider();
        withConfig((config) => {
          addProvider(config, provider);
          registerAutoAliases(config, provider.name, provider.models.map((m) => m.id));
        });
        success(`Added provider "${provider.name}" with ${provider.models.length} model(s).`);
        info(`Run \`cctra alias\` to inspect auto-generated aliases; \`cctra serve\` to start.`);
      } catch (e) {
        if ((e as Error).message.includes("cancelled")) return;
        errorOut((e as Error).message);
        process.exit(1);
      }
    });
}

async function promptNewProvider(): Promise<Provider> {
  // 1. Vendor（可跳过 → 走纯手输）
  const vendor = checkCancel(
    await p.autocomplete<ProviderPreset>({
      message: "Select a vendor (type to search, or pick '手动配置' for custom):",
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
      message: "Provider name:",
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
    kind: "provider",
    vendor: isCustom ? undefined : vendor.name,
    name: name.trim().toLowerCase(),
    endpoint: endpoint.trim(),
    token: token.trim(),
    apiFormat,
    ...(apiFormat === "openai-responses" ? { responsesPath: "/v1/responses" } : {}),
    models: selected.map((id) => ({ id })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * 给一批 model id 在 config.aliases 里注册 auto-alias。
 *   - 全局唯一 → aliases[id] = "provider/id"
 *   - 已有同名 alias 或冲突 → 跳过
 * 调用前 provider 必须已经写入 config，所以 autoAliasValue 会算到自己（count=1 仍 ok）。
 */
function registerAutoAliases(
  config: Config,
  providerName: string,
  modelIds: string[],
): void {
  for (const id of modelIds) {
    const value = autoAliasValue(id, providerName, config);
    if (value) config.aliases[id] = value;
  }
}
