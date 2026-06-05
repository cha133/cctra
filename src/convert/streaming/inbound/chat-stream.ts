// v1 简化：流式转换的占位实现
// 完整版要把 OpenAI Chat SSE 增量转成 CanonicalChunk
// 当前先把 chunk 的 raw data 透传，到 outbound 阶段再转

import type { CanonicalChunk } from "../../../canonical/types";
import { parseSseStream } from "../../../server/sse";

export async function* chatStreamToCanonical(rawStream: ReadableStream<Uint8Array>): AsyncGenerator<CanonicalChunk> {
  for await (const ev of parseSseStream(rawStream)) {
    if (ev.data === "[DONE]") {
      yield { type: "message_stop" };
      continue;
    }
    try {
      const parsed = JSON.parse(ev.data) as {
        choices?: Array<{
          delta?: { content?: unknown };
          finish_reason?: string;
        }>;
      };
      // v1 简化：直接透传为 content_block_delta（text 增量）
      // 完整版需要状态机维护 tool_call id 映射
      const choice = parsed.choices?.[0];
      const content = choice?.delta?.content;
      if (typeof content === "string" && content.length > 0) {
        yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: content } };
      }
      if (choice?.finish_reason) {
        yield { type: "message_delta", delta: { stop_reason: mapStopReason(choice.finish_reason) } };
        yield { type: "message_stop" };
      }
    } catch {
      // 跳过解析失败的 chunk
    }
  }
}

function mapStopReason(r: string): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "error" {
  switch (r) {
    case "stop": return "end_turn";
    case "length": return "max_tokens";
    case "tool_calls": return "tool_use";
    case "content_filter": return "error";
    default: return "end_turn";
  }
}
