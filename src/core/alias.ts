// ============================================================================
// Auto-alias 注册决策
// 规则：cctra add / edit 时，如果 model id 在所有 source / 已有 aliases / 本批
//       内都唯一，且没撞 source 名 → 静默注册 aliases[id] = "provider/id"
//       否则 → 不注册，用户必须用 provider/model 全名
// ============================================================================
import type { Config, Model } from "../types";

/**
 * 判定 id 是否可以安全地静默注册成 alias
 * @param config 当前 config 快照
 * @param excludeSource 跳过该 source（用于 edit 时不算自己）
 */
export function canAutoRegisterAlias(
  id: string,
  config: Config,
  excludeSource?: string,
): boolean {
  if (!id) return false;
  // 1. id 不能撞已有 alias 名
  if (config.aliases[id] !== undefined) return false;
  // 2. id 不能撞 source 名（provider / plugin）
  if (config.providers[id] || config.plugins[id]) return false;
  // 3. id 在所有 source 内的 model.id 中必须唯一（除自身 source）
  let count = 0;
  for (const [pname, p] of Object.entries(config.providers)) {
    if (pname === excludeSource) continue;
    if (p.models.some((m) => m.id === id)) count++;
    if (count > 1) return false;
  }
  for (const [pname, p] of Object.entries(config.plugins)) {
    if (pname === excludeSource) continue;
    if (p.models.some((m) => m.id === id)) count++;
    if (count > 1) return false;
  }
  // count <= 1：当前为 0（新建）或 1（已存在；通常发生在 add 完后再调一次，但 add
  //   流程里我们在 model 注册前调，所以 count=0；edit 流程里 excludeSource 跳过自己，
  //   仍是 0）
  return count <= 1;
}

/**
 * 算出 model 的 alias 值（"provider/id" 全名），返回 null 表示不能 auto-register
 * @param newBatch 本批正在处理的新 model 列表（防同批 id 重复）
 */
export function autoAliasValue(
  id: string,
  providerName: string,
  config: Config,
  newBatch?: Model[],
  excludeSource?: string,
): string | null {
  if (!canAutoRegisterAlias(id, config, excludeSource)) return null;
  if (newBatch?.some((m) => m.id === id)) return null;
  return `${providerName}/${id}`;
}
