// ============================================================================
// GET /v1/models 处理器
// 聚合所有订阅和插件的模型，按 OpenAI 格式输出
// ============================================================================
import { loadConfigFile } from "../../core/config";

export function handleModels(): Response {
  const config = loadConfigFile();
  const items: Array<{ id: string; object: "model"; created: number; owned_by: string }> = [];
  const now = Math.floor(Date.now() / 1000);

  for (const [subName, sub] of Object.entries(config.subscriptions)) {
    for (const m of sub.models) {
      items.push({ id: `${subName}/${m.id}`, object: "model", created: now, owned_by: subName });
      if (m.alias) {
        items.push({ id: `${subName}/${m.alias}`, object: "model", created: now, owned_by: subName });
      }
    }
  }
  for (const [pluginName, plugin] of Object.entries(config.plugins)) {
    if (!plugin.enabled) continue;
    for (const m of plugin.models) {
      items.push({ id: `${pluginName}/${m.id}`, object: "model", created: now, owned_by: pluginName });
      if (m.alias) {
        items.push({ id: `${pluginName}/${m.alias}`, object: "model", created: now, owned_by: pluginName });
      }
    }
  }

  return Response.json({ object: "list", data: items });
}
