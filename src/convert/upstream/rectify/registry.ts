// ============================================================================
// 内置 rectify 规则注册表
// v1 只装 1 条规则：normalize-thinking-type
// 新规则：写一个 .ts 文件 export default 一个 RectifyRule，然后在这里 import 加进 BUILTIN_RULES
// ============================================================================
import type { ApiFormat } from "../../../canonical/types";
import type { Source } from "../../../types";
import normalizeThinkingType from "./rules/normalize-thinking-type";

export interface RectifyRuleContext {
  source: Source;
  apiFormat: ApiFormat;
}

export interface RectifyRule {
  /** kebab-case 短 id，CLI 和 config 都用这个引用 */
  id: string;
  /** 人类可读名（list 输出用） */
  displayName: string;
  /** 一句话描述（list 输出 + README 用） */
  description: string;
  /**
   * 规则函数。直接 mutate body 即可。
   * throw 会被 runRectifiers 捕获并 log warn + 跳过本规则。
   */
  fn: (body: unknown, ctx: RectifyRuleContext) => void;
}

export const BUILTIN_RULES: RectifyRule[] = [normalizeThinkingType];

/** 给 CLI 校验用：「这个 rule id 是内置的」 */
export const BUILTIN_RULE_IDS: ReadonlySet<string> = new Set(
  BUILTIN_RULES.map((r) => r.id),
);

export function getBuiltinRule(id: string): RectifyRule | null {
  return BUILTIN_RULES.find((r) => r.id === id) ?? null;
}