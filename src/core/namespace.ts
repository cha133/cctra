// ============================================================================
// Namespace 防御：alias 名和 provider/plugin 名共享同一 namespace，禁止冲突
// ============================================================================

import type { Config } from "../types";

/** 名字是否被某个 provider 或 plugin 占（不区分 enabled） */
export function isSourceName(config: Config, name: string): boolean {
  return config.providers[name] !== undefined || config.plugins[name] !== undefined;
}

/** 名字是否被某个 alias 槽位占（含 unbound） */
export function isAliasName(config: Config, name: string): boolean {
  return config.aliases[name] !== undefined;
}

/** 名字是否在任一 namespace 里被占 */
export function nameTakenAnywhere(config: Config, name: string): boolean {
  return isSourceName(config, name) || isAliasName(config, name);
}

/** 报告 name 被谁占了（给错误信息用） */
export function describeNameOwner(config: Config, name: string): string | null {
  if (config.providers[name]) return `provider "${name}"`;
  if (config.plugins[name]) return `plugin "${name}"`;
  if (config.aliases[name] !== undefined) return `alias "${name}"`;
  return null;
}

/** kebab-case 校验，1-63 字符 */
const ALIAS_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export function isValidAliasName(name: string): boolean {
  return ALIAS_NAME_RE.test(name);
}
