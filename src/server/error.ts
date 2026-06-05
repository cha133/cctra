// ============================================================================
// 错误信封：按客户端协议分别包装
// 上游错误 JSON 优先透传（status + body），代理本身失败才用代理信封
// ============================================================================

export function chatErrorBody(message: string, type = "cctra_error"): Record<string, unknown> {
  return { error: { message, type } };
}

export function anthropicErrorBody(message: string, type = "cctra_error"): Record<string, unknown> {
  return { type: "error", error: { type, message } };
}

export function responsesErrorBody(message: string, code = "cctra_error"): Record<string, unknown> {
  return { error: { message, code } };
}
