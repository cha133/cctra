import type { Config, Source, Model } from "../types";
import { getSource } from "./source";
import { resolveTier } from "../tier/resolve";

/**
 * 解析模型引用字符串，返回 (Source, upstreamModelId, apiFormat)
 *
 * 解析优先级：
 *   1. tier 名字（cctra / cctra-pro / cctra-flash / cctra-vision 或用户自建）
 *   2. "sub/model" 或 "plugin/model"（按 / 拆分）
 *   3. 全局 alias（在所有 source 的 model.alias 里找）
 *   4. 都不匹配 → null
 */
export function resolveModelRef(
  ref: string,
  config: Config,
): { source: Source; modelId: string } | null {
  if (!ref) return null;

  const trimmed = ref.trim();

  // 1. tier 名字
  const tierResolved = resolveTier(trimmed, config);
  if (tierResolved) return tierResolved;

  // 2. "sub/model" 格式
  if (trimmed.includes("/")) {
    const [sourceName, modelPart] = trimmed.split("/", 2);
    if (!sourceName || !modelPart) return null;
    const source = getSource(config, sourceName);
    if (!source) return null;
    const model = findModelInSource(source, modelPart);
    if (!model) return null;
    return { source, modelId: model.id };
  }

  // 3. 全局 alias
  const aliasMatches: Array<{ source: Source; modelId: string }> = [];
  for (const source of Object.values(config.subscriptions)) {
    const m = findModelInSource(source, trimmed);
    if (m) aliasMatches.push({ source, modelId: m.id });
  }
  for (const plugin of Object.values(config.plugins)) {
    if (!plugin.enabled) continue;
    const m = findModelInSource(plugin, trimmed);
    if (m) aliasMatches.push({ source: plugin, modelId: m.id });
  }
  if (aliasMatches.length === 1) return aliasMatches[0]!;
  if (aliasMatches.length > 1) {
    // 多个匹配：抛错（上层包装成 400）
    const names = aliasMatches.map((m) => `${m.source.name}/${m.modelId}`).join(", ");
    throw new ResolveError(`Ambiguous model alias "${trimmed}". Candidates: ${names}`);
  }

  return null;
}

/** 在 source 的 models 列表里按 id 或 alias 找 */
function findModelInSource(source: Source, ref: string): Model | null {
  return (
    source.models.find((m) => m.id === ref) ??
    source.models.find((m) => m.alias === ref) ??
    null
  );
}

/** 解析错误（用 throw 表达歧义或不存在） */
export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolveError";
  }
}
