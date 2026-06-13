// ============================================================================
// runRectifiers — 上游发 HTTP 之前的最后一道 vendor-quirk 处理
// ----------------------------------------------------------------------------
// 触发点：src/server/upstream.ts 的 callUpstream / callUpstreamStream，在
// canonicalTo*Upstream 之后、cancelableFetch 之前。
//
// 解析 config.rectify：
//   1. 全局 enabled 集合（config.rectify.rules[id] === true）
//   2. source 白名单（source.name 必须在 config.rectify.providers[source.name] 里）
//
// 两条 AND：全局开启 AND provider 显式 attach → 才跑。Plugin source v1 不支持
// attach（plugin 自带 JS 处理 quirks）。
//
// 错误策略：单条规则 throw → logger.warn + 跳过本规则；不影响后续规则 / 不影响请求。
// ============================================================================
import type { ApiFormat } from "../../../canonical/types";
import type { Config, Source } from "../../../types";
import { loadConfigFile } from "../../../core/config";
import { logger } from "../../../utils/logger";
import { BUILTIN_RULES, getBuiltinRule } from "./registry";

/**
 * 跑当前请求 source 上挂的所有有效 rectify 规则。直接 mutate upstreamBody。
 * @returns 同一个 upstreamBody（方便调用方 chain）
 */
export function runRectifiers(
  upstreamBody: unknown,
  source: Source,
  apiFormat: ApiFormat,
): unknown {
  const config = loadConfigFile();
  const rules = resolveActiveRules(config, source);
  for (const rule of rules) {
    try {
      rule.fn(upstreamBody, { source, apiFormat });
    } catch (e) {
      logger.warn(
        `[rectify:${rule.id}] threw on ${source.name}/${apiFormat}: ${(e as Error).message}`,
      );
    }
  }
  return upstreamBody;
}

/**
 * 给 CLI 的 attach / detach 用：返回「如果源是 source，会跑哪些规则」。
 * 复用 runRectifiers 的同一套解析逻辑。
 */
export function listActiveRulesFor(
  config: Config,
  sourceName: string,
): typeof BUILTIN_RULES {
  const rules = config.rectify?.rules ?? {};
  const providers = config.rectify?.providers ?? {};
  const attached = providers[sourceName] ?? [];
  return BUILTIN_RULES.filter(
    (r) => rules[r.id] === true && attached.includes(r.id),
  );
}

/** 给 CLI ls 用：列出所有内置规则 + 全局开关 + 每个 source 的 attach */
export function summarizeRectifyConfig(config: Config): {
  rules: Array<{ id: string; displayName: string; enabled: boolean; description: string }>;
  attachments: Array<{ source: string; rules: string[] }>;
} {
  const ruleStates = config.rectify?.rules ?? {};
  const rules = BUILTIN_RULES.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    description: r.description,
    enabled: ruleStates[r.id] === true,
  }));
  const attachments = Object.entries(config.rectify?.providers ?? {})
    .filter(([, rs]) => Array.isArray(rs) && rs.length > 0)
    .map(([source, rs]) => ({ source, rules: rs }));
  return { rules, attachments };
}

// ----------------------------------------------------------------------------
// 内部 helpers
// ----------------------------------------------------------------------------

function resolveActiveRules(config: Config, source: Source): typeof BUILTIN_RULES {
  // plugin v1 不支持 attach；直接空
  if (source.kind !== "provider") return [];
  const ruleStates = config.rectify?.rules ?? {};
  const attached = config.rectify?.providers?.[source.name] ?? [];
  return BUILTIN_RULES.filter(
    (r) => ruleStates[r.id] === true && attached.includes(r.id),
  );
}

/** 给 CLI 校验用：内置规则 id 集合（CLI 从 registry.ts 直接 import） */
export { BUILTIN_RULE_IDS } from "./registry";