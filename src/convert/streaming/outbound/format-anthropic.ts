// ============================================================================
// CanonicalChunk → Anthropic Messages SSE 流式输出格式化
// ---------------------------------------------------------------------------
// CanonicalChunk 形状几乎对齐 Anthropic SSE，所以基本直接 JSON.stringify 透传。
// 唯一精细化：发严格的双行格式 `event: <name>\ndata: <json>\n\n`（Anthropic 客户端通常按 event 名分类）
// ============================================================================

import type { CanonicalChunk } from "../../../canonical/types";

export class AnthropicStreamFormatter {
  // Anthropic 流式无累积状态，每个 chunk 独立
  format(chunk: CanonicalChunk): string[] {
    return [`event: ${chunk.type}\ndata: ${JSON.stringify(chunk)}\n\n`];
  }
}
