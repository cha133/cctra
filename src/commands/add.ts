// ============================================================================
// cctra add：交互式添加订阅
// ============================================================================
import * as p from "@clack/prompts";
import { Command } from "commander";
import { checkCancel } from "../ui/prompts";
import { success, error as errorOut, info } from "../ui/format";
import { withConfig } from "./shared";
import { addSubscription } from "../core/config";
import { fetchUpstreamModels } from "../core/model-fetch";
import type { Subscription, ApiFormat } from "../types";

export function registerAdd(program: Command): void {
  program
    .command("add")
    .description("Interactively add a subscription")
    .action(async () => {
      try {
        const sub = await promptNewSubscription();
        withConfig((config) => addSubscription(config, sub));
        success(`Added subscription "${sub.name}" with ${sub.models.length} model(s).`);
        info(`Run \`cctra serve\` to start the daemon.`);
      } catch (e) {
        if ((e as Error).message.includes("cancelled")) return;
        errorOut((e as Error).message);
        process.exit(1);
      }
    });
}

async function promptNewSubscription(): Promise<Subscription> {
  // 1. 名称
  const name = checkCancel(
    await p.text({
      message: "Subscription name:",
      placeholder: "e.g. ark-agent-plan, deepseek",
      validate: (v) => {
        if (!v?.trim()) return "Name is required.";
        const n = v.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9-]*$/.test(n)) return 'Use kebab-case: lowercase letters, digits, hyphens.';
        return undefined;
      },
    }),
  );

  // 2. 协议
  const apiFormat = checkCancel(
    await p.select<ApiFormat>({
      message: "Upstream API format:",
      options: [
        { value: "openai-chat", label: "OpenAI Chat Completions" },
        { value: "openai-responses", label: "OpenAI Responses" },
        { value: "anthropic-messages", label: "Anthropic Messages" },
      ],
    }),
  );

  // 3. Endpoint
  const endpoint = checkCancel(
    await p.text({
      message: "Endpoint URL (root, no /v1 suffix):",
      placeholder: "e.g. https://ark.cn-beijing.volces.com/api/plan",
      validate: (v) => (!v?.trim() ? "Endpoint is required." : undefined),
    }),
  );

  // 4. Token
  const token = checkCancel(
    await p.password({
      message: "API key / token:",
      validate: (v) => (!v?.trim() ? "Token is required." : undefined),
    }),
  );

  // 5. 拉模型列表
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

  // 6. 选模型
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
    name: name.trim().toLowerCase(),
    endpoint: endpoint.trim(),
    token: token.trim(),
    apiFormat,
    models: selected.map((id) => ({ id })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
