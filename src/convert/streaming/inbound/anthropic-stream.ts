// v1 简化：Anthropic SSE 已经是 CanonicalChunk 的近亲，直接透传
import type { CanonicalChunk } from "../../../canonical/types";
import { parseSseStream } from "../../../server/sse";

export async function* anthropicStreamToCanonical(rawStream: ReadableStream<Uint8Array>): AsyncGenerator<CanonicalChunk> {
  for await (const ev of parseSseStream(rawStream)) {
    try {
      const parsed = JSON.parse(ev.data) as CanonicalChunk;
      yield parsed;
    } catch {
      // 跳过
    }
  }
}
