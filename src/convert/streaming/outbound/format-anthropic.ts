// ============================================================================
// CanonicalChunk → Anthropic Messages SSE 流式输出格式化
// ---------------------------------------------------------------------------
// 大部分事件与 Anthropic SSE 字段名对齐，可直接 JSON.stringify 透传。
// message_start 需构建完整 Anthropic message 对象（含 type/role/stop_reason 等字段），
// message_delta 的 usage 需从 canonical camelCase 转为 Anthropic snake_case。
// ============================================================================

import type { CanonicalChunk } from "../../../canonical/types";
import { mapStopReasonToAnthropic } from "../../upstream/canonical-to-anthropic";

/**
 * 将任意命名约定的 usage 归一化为 Anthropic 格式（snake_case）。
 * 同时支持：
 * - canonical camelCase: inputTokens / outputTokens
 * - anthropic snake_case: input_tokens / output_tokens
 */
function normalizeUsage(usage: Record<string, unknown> | undefined): {
  input_tokens: number;
  output_tokens: number;
  total_tokens?: number;
} {
  const u = usage ?? {};
  const input_tokens = (u.input_tokens ?? u.inputTokens ?? 0) as number;
  const output_tokens = (u.output_tokens ?? u.outputTokens ?? 0) as number;
  const total = u.total_tokens as number | undefined;
  return {
    input_tokens,
    output_tokens,
    ...(total !== undefined ? { total_tokens: total } : { total_tokens: input_tokens + output_tokens }),
  };
}

export class AnthropicStreamFormatter {
  // 流中错已发 error event：抑制 message_stop（避免"错 + 完成"矛盾信号）
  private _streamEndedWithError = false;

  format(chunk: CanonicalChunk): string[] {
    if (chunk.type === "error") this._streamEndedWithError = true;
    if (chunk.type === "message_stop" && this._streamEndedWithError) return [];

    switch (chunk.type) {
      case "message_start":
        return [this.formatMessageStart(chunk)];
      case "message_delta":
        return [this.formatMessageDelta(chunk)];
      default:
        // content_block_* / message_stop / ping / error：字段与 Anthropic SSE 对齐，直接透传
        return [`event: ${chunk.type}\ndata: ${JSON.stringify(chunk)}\n\n`];
    }
  }

  private formatMessageStart(chunk: CanonicalChunk & { type: "message_start" }): string {
    const msg = chunk.message as unknown as Record<string, unknown>;
    const usage = normalizeUsage(msg.usage as Record<string, unknown> | undefined);
    return `event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: {
        id: msg.id,
        type: "message",
        role: "assistant",
        model: msg.model,
        content: msg.content ?? [],
        stop_reason: null,
        stop_sequence: null,
        usage,
      },
    })}\n\n`;
  }

  private formatMessageDelta(chunk: CanonicalChunk & { type: "message_delta" }): string {
    const usage = normalizeUsage(chunk.usage as Record<string, unknown> | undefined);
    // 流式等价修复：canonical stop_reason="error" 对 Anthropic 客户端非法，
    // 映射为 refusal（AnthropicStopReason 的合法值）
    const delta = chunk.delta.stop_reason === "error"
      ? { ...chunk.delta, stop_reason: mapStopReasonToAnthropic(chunk.delta.stop_reason) as "end_turn" }
      : chunk.delta;
    return `event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta",
      delta,
      usage,
    })}\n\n`;
  }
}
