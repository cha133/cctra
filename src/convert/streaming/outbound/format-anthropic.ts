// ============================================================================
// CanonicalChunk → Anthropic Messages SSE 流式输出格式化
// ---------------------------------------------------------------------------
// content block 事件与 Anthropic SSE 对齐；message / usage 则需显式转成 Anthropic wire shape。
// 每个事件使用严格的双行格式 `event: <name>\ndata: <json>\n\n`。
// ============================================================================

import type { CanonicalChunk } from "../../../canonical/types";
import { mapStopReasonToAnthropic } from "../../upstream/canonical-to-anthropic";

export class AnthropicStreamFormatter {
  // 流中错已发 error event：抑制 message_stop（避免"错 + 完成"矛盾信号）
  private _streamEndedWithError = false;

  format(chunk: CanonicalChunk): string[] {
    if (chunk.type === "error") this._streamEndedWithError = true;
    if (chunk.type === "message_stop" && this._streamEndedWithError) return [];
    let out: unknown = chunk;
    if (chunk.type === "message_start") {
      out = {
        type: "message_start",
        message: {
          id: chunk.message.id,
          type: "message",
          role: "assistant",
          content: [],
          model: chunk.message.model,
          stop_reason: null,
          stop_sequence: null,
          usage: formatUsage(chunk.message.usage),
        },
      };
    } else if (chunk.type === "message_delta") {
      out = {
        type: "message_delta",
        delta: {
          stop_reason: chunk.delta.stop_reason === undefined
            ? null
            : mapStopReasonToAnthropic(chunk.delta.stop_reason),
          stop_sequence: chunk.delta.stop_sequence ?? null,
        },
        ...(chunk.usage ? { usage: formatUsage(chunk.usage) } : {}),
      };
    }
    return [`event: ${chunk.type}\ndata: ${JSON.stringify(out)}\n\n`];
  }
}

function formatUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): Record<string, number> {
  return {
    ...(usage.inputTokens !== undefined ? { input_tokens: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { output_tokens: usage.outputTokens } : {}),
    ...(usage.cacheReadTokens !== undefined ? { cache_read_input_tokens: usage.cacheReadTokens } : {}),
    ...(usage.cacheWriteTokens !== undefined ? { cache_creation_input_tokens: usage.cacheWriteTokens } : {}),
  };
}
