import type { CanonicalUsage } from "../../canonical/types";

// 把 CanonicalUsage 拆成 OpenAI 风格的 input/output
export function splitUsage(u: CanonicalUsage): { prompt_tokens: number; completion_tokens: number } {
  return {
    prompt_tokens: u.inputTokens,
    completion_tokens: u.outputTokens,
  };
}

// 合并增量到 usage（流式用）
export function mergeUsage(base: CanonicalUsage, delta: Partial<CanonicalUsage>): CanonicalUsage {
  return {
    inputTokens: delta.inputTokens ?? base.inputTokens,
    outputTokens: delta.outputTokens ?? base.outputTokens,
    cacheReadTokens: delta.cacheReadTokens ?? base.cacheReadTokens,
    cacheWriteTokens: delta.cacheWriteTokens ?? base.cacheWriteTokens,
  };
}
