// v1 简化：OpenAI Responses SSE 暂用 Chat 的解析逻辑（output_text.delta 事件映射成 text_delta）
import type { CanonicalChunk } from "../../../canonical/types";
import { parseSseStream } from "../../../server/sse";

export async function* responsesStreamToCanonical(rawStream: ReadableStream<Uint8Array>): AsyncGenerator<CanonicalChunk> {
  for await (const ev of parseSseStream(rawStream)) {
    if (ev.data === "[DONE]") {
      yield { type: "message_stop" };
      continue;
    }
    try {
      const parsed = JSON.parse(ev.data) as { type?: string; delta?: string; response?: { usage?: { input_tokens?: number; output_tokens?: number } } };
      // output_text.delta 事件
      if (parsed.type === "response.output_text.delta" && parsed.delta) {
        yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: parsed.delta } };
      } else if (parsed.type === "response.completed") {
        yield { type: "message_delta", delta: { stop_reason: "end_turn" } };
        yield { type: "message_stop" };
      }
    } catch {
      // 跳过
    }
  }
}
