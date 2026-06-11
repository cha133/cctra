// ============================================================================
// Auto-alias 决策
// 规则：model id 在所有 source 里没被用作 id 或 alias → 静默设 alias=id
//       有冲突 / 用户显式输入别的东西 → 不设 / 用用户的
// ============================================================================
import type { Config, Model } from "../types";

/**
 * 判定 id 是否可以安全地静默设 alias=id
 * @param excludeSource 跳过该 source（用于「同一 provider 内」判断）
 */
export function canAutoAlias(
  id: string,
  config: Config,
  excludeSource?: string,
): boolean {
  if (!id) return false;
  for (const [providerName, provider] of Object.entries(config.providers)) {
    if (providerName === excludeSource) continue;
    if (provider.models.some((m) => m.id === id || m.alias === id)) return false;
  }
  for (const [name, p] of Object.entries(config.plugins)) {
    if (name === excludeSource || !p.enabled) continue;
    if (p.models.some((m) => m.id === id || m.alias === id)) return false;
  }
  return true;
}

/**
 * 算出 model 的最终 alias
 * @returns alias 字符串（id 本身）表示可 auto-alias；undefined 表示不能
 *
 * 三个判定层：
 *   1. 已有 config 里是否被占用（排除指定 source）
 *   2. 本批内（newBatch）是否已经用过
 *   3. 都通过 → 返回 id
 */
export function resolveAutoAlias(
  id: string,
  config: Config,
  newBatch?: Model[],
  excludeSource?: string,
): string | undefined {
  if (!canAutoAlias(id, config, excludeSource)) return undefined;
  if (newBatch?.some((m) => m.id === id || m.alias === id)) return undefined;
  return id;
}
