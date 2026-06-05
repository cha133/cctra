import type { Config, Source } from "../types";
import { getSource } from "../core/source";

/**
 * 把 tier 名字解析成 (Source, upstreamModelId)
 * tier 的 target 是 "sub/model" 或 "plugin/model" 格式
 * 找不到映射或映射到的 source/model 不存在时返回 null
 */
export function resolveTier(
  name: string,
  config: Config,
): { source: Source; modelId: string } | null {
  const tier = config.tiers[name];
  if (!tier || !tier.target) return null;

  // 递归解析（支持 tier → tier）
  if (config.tiers[tier.target]) {
    return resolveTier(tier.target, config);
  }

  // 解析 "sub/model" 格式
  if (!tier.target.includes("/")) return null;
  const [sourceName, modelPart] = tier.target.split("/", 2);
  if (!sourceName || !modelPart) return null;
  const source = getSource(config, sourceName);
  if (!source) return null;
  const model = source.models.find((m) => m.id === modelPart || m.alias === modelPart);
  if (!model) return null;
  return { source, modelId: model.id };
}

/** 列出所有 4 个预定义 tier 名字（用于 CLI 提示等） */
export const BUILTIN_TIER_NAMES = ["cctra", "cctra-pro", "cctra-flash", "cctra-vision"] as const;
