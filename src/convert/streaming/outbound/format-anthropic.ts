// ============================================================================
// CanonicalChunk → Anthropic Messages SSE 流式输出格式化
// ---------------------------------------------------------------------------
// CanonicalChunk 形状几乎对齐 Anthropic SSE，所以基本直接 JSON.stringify 透传。
// 唯一精细化：发严格的双行格式 `event: <name>\ndata: <json>\n\n`（Anthropic 客户端通常按 event 名分类）
// ============================================================================

import type { CanonicalChunk } from "../../../canonical/types";
import { mapStopReasonToAnthropic } from "../../upstream/canonical-to-anthropic";

export class AnthropicStreamFormatter {
  // 流中错已发 error event：抑制 message_stop（避免"错 + 完成"矛盾信号）
  private _streamEndedWithError = false;

  format(chunk: CanonicalChunk): string[] {
    if (chunk.type === "error") this._streamEndedWithError = true;
    if (chunk.type === "message_stop" && this._streamEndedWithError) return [];
    // 流式等价修复：上游 finish_reason=content_filter → canonical stop_reason="error" → 透传给 Anthropic 客户端非法
    // 这里把 message_delta 里的 stop_reason 从 "error" 映射成 "refusal"
    // 备注：AnthropicStopReason 包含 "refusal" 但 canonical StopReason 不含；这是 canonical→anthropic 输出层，refusal 合法所以 cast
    const out: CanonicalChunk = chunk.type === "message_delta" && chunk.delta.stop_reason === "error"
      ? { ...chunk, delta: { ...chunk.delta, stop_reason: mapStopReasonToAnthropic(chunk.delta.stop_reason) as "end_turn" } }
      : chunk;
    return [`event: ${out.type}\ndata: ${JSON.stringify(out)}\n\n`];
  }
}
