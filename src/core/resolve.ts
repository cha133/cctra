import type { Config, Source, Model } from "../types";
import { getSource } from "./source";

/**
 * 解析模型引用字符串，返回 (Source, upstreamModelId)
 *
 * 解析优先级：
 *   1. "provider/model" 或 "plugin/model"（按第一个 / 拆分；先按 id，再按 alias 找）
 *   2. 全局 alias（在所有 source 的 model.id / model.alias 里找）
 *   3. 都不匹配 → null
 */
export function resolveModelRef(
  ref: string,
  config: Config,
): { source: Source; modelId: string } | null {
  if (!ref) return null;

  const trimmed = ref.trim();

  // 1. "provider/model" 格式
  if (trimmed.includes("/")) {
    const [sourceName, modelPart] = trimmed.split("/", 2);
    if (!sourceName || !modelPart) return null;
    const source = getSource(config, sourceName);
    if (!source) return null;
    const model = findModelInSource(source, modelPart);
    if (!model) return null;
    return { source, modelId: model.id };
  }

  // 2. 全局 alias
  const aliasMatches: Array<{ source: Source; modelId: string }> = [];
  for (const source of Object.values(config.providers)) {
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
