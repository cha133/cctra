// ============================================================================
// 错误响应 → HTTP status code 单一来源
// 避免 cc-switch 那种 `IntoResponse` + `map_proxy_error_to_status` 双轨 footgun
// ============================================================================
import type { CanonicalResponse } from "../canonical/types";

/**
 * 从 CanonicalResponse 决定 HTTP status code。
 * - 错误响应有 status 字段 → 透传上游
 * - 错误响应无 status 字段（如 plugin/network/parse 错）→ 500
 * - 非错误响应 → undefined（调用方用默认 200）
 */
export function errorResponseToHttpStatus(
  response: CanonicalResponse,
): number | undefined {
  if (!response.error) return undefined;
  return response.error.status ?? 500;
}
