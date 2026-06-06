// ============================================================================
// CanonicalChunk → Anthropic Messages SSE 流式输出格式化
// ---------------------------------------------------------------------------
// CanonicalChunk 形状几乎对齐 Anthropic SSE，所以基本直接 JSON.stringify 透传。
// 唯一精细化：发严格的双行格式 `event: <name>\ndata: <json>\n\n`（Anthropic 客户端通常按 event 名分类）
// ============================================================================

import type { CanonicalChunk } from "../../../canonical/types";

export class AnthropicStreamFormatter {
  // 流中错已发 error event：抑制 message_stop（避免"错 + 完成"矛盾信号）
  private _streamEndedWithError = false;

  format(chunk: CanonicalChunk): string[] {
    if (chunk.type === "error") this._streamEndedWithError = true;
    if (chunk.type === "message_stop" && this._streamEndedWithError) return [];
    return [`event: ${chunk.type}\ndata: ${JSON.stringify(chunk)}\n\n`];
  }
}
