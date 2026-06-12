// ============================================================================
// GET /v1/models 处理器
// 聚合所有 provider 和插件的模型，并追加 config.aliases 的所有 key（含 unbound）
// 按 OpenAI 格式输出
// ============================================================================
import { loadConfigFile } from "../../core/config";

interface ModelItem {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  cctra_target?: string | null;
}

export function handleModels(): Response {
  const config = loadConfigFile();
  const items: ModelItem[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const [providerName, provider] of Object.entries(config.providers)) {
    for (const m of provider.models) {
      items.push({ id: `${providerName}/${m.id}`, object: "model", created: now, owned_by: providerName });
    }
  }
  for (const [pluginName, plugin] of Object.entries(config.plugins)) {
    if (!plugin.enabled) continue;
    for (const m of plugin.models) {
      items.push({ id: `${pluginName}/${m.id}`, object: "model", created: now, owned_by: pluginName });
    }
  }

  // 追加 alias 列表（含 unbound）—— 用 cctra-alias owned_by 让 UI 客户端能区分
  for (const [name, value] of Object.entries(config.aliases)) {
    items.push({
      id: name,
      object: "model",
      created: now,
      owned_by: "cctra-alias",
      cctra_target: value || null,
    });
  }

  return Response.json({ object: "list", data: items });
}
