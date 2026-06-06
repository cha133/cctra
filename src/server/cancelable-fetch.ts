// ============================================================================
// cancelableFetch：合并客户端 abort signal + 上游硬超时
// 客户端断网 / Ctrl+C → 立刻取消上游 fetch（不再浪费 token）
// ============================================================================

const DEFAULT_TIMEOUT_MS = 60_000 * 5; // 5 分钟（保持现有行为）

/**
 * 用 AbortSignal.any 合并 clientSignal + timeout signal，注入 fetch
 */
export function cancelableFetch(
  url: string,
  init: RequestInit,
  clientSignal: AbortSignal | undefined,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signals: AbortSignal[] = clientSignal ? [clientSignal, timeoutSignal] : [timeoutSignal];
  const merged = signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
  return fetch(url, { ...init, signal: merged });
}
