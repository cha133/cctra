// ============================================================================
// CanonicalChunk → OpenAI Chat Completions SSE 流式输出格式化
// ---------------------------------------------------------------------------
// 关键状态：
//   - 每个 tool_use Canonical block 在 OpenAI Chat 里对应一个 tool_calls[i] 槽位
//   - 第一次见到 tool_use 时必须发完整 skeleton（id+name+type+空 arguments）
//   - 后续 arguments 增量只发 {tool_calls:[{index,function:{arguments:partial}}]}
//   - thinking/signature delta 在 OpenAI Chat 协议无对应 → 静默丢弃
// ============================================================================

import type { CanonicalChunk, StopReason } from "../../../canonical/types";

interface ToolSlot {
  toolIndex: number;
  id: string;
  name: string;
}

export class ChatStreamFormatter {
  private id = `chatcmpl-${Date.now()}`;
  private created = Math.floor(Date.now() / 1000);
  private model = "";
  private nextToolIndex = 0;
  // Canonical block_index → OpenAI tool_calls 槽位
  private blockToToolSlot = new Map<number, ToolSlot>();
  // 流中错已发 error event：抑制 [DONE]（避免"错 + 完成"矛盾信号）
  private _streamEndedWithError = false;

  format(chunk: CanonicalChunk): string[] {
    switch (chunk.type) {
      case "message_start": {
        if (chunk.message.id) this.id = chunk.message.id;
        if (chunk.message.model) this.model = chunk.message.model;
        return [];
      }

      case "content_block_start": {
        if (chunk.content_block.type === "tool_use") {
          const slot: ToolSlot = {
            toolIndex: this.nextToolIndex++,
            id: chunk.content_block.id,
            name: chunk.content_block.name,
          };
          this.blockToToolSlot.set(chunk.index, slot);
          return [this.makeChunk({
            tool_calls: [{
              index: slot.toolIndex,
              id: slot.id,
              type: "function",
              function: { name: slot.name, arguments: "" },
            }],
          })];
        }
        // text / thinking block_start 不发（OpenAI Chat 不预声明 text block）
        return [];
      }

      case "content_block_delta": {
        if (chunk.delta.type === "text_delta") {
          return [this.makeChunk({ content: chunk.delta.text })];
        }
        if (chunk.delta.type === "input_json_delta") {
          const slot = this.blockToToolSlot.get(chunk.index);
          if (!slot) return [];
          return [this.makeChunk({
            tool_calls: [{
              index: slot.toolIndex,
              function: { arguments: chunk.delta.partial_json },
            }],
          })];
        }
        // thinking_delta / signature_delta → OpenAI Chat 无对应，丢
        return [];
      }

      case "content_block_stop":
        // OpenAI Chat 不显式 stop content block
        return [];

      case "message_delta": {
        const stop = chunk.delta.stop_reason;
        if (!stop) return [];
        return [this.makeFinishChunk(stop)];
      }

      case "message_stop":
        // 流中错时抑制 [DONE]（cc-switch 二元化约束）
        if (this._streamEndedWithError) return [];
        return ["data: [DONE]\n\n"];

      case "ping":
        return [];

      case "error": {
        // 流中错：发 error SSE event + 设抑制标志
        this._streamEndedWithError = true;
        return [`data: ${JSON.stringify({
          error: { message: chunk.error, type: "upstream_error" },
        })}\n\n`];
      }
    }
  }

  private makeChunk(delta: Record<string, unknown>): string {
    return `data: ${JSON.stringify({
      id: this.id,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: null }],
    })}\n\n`;
  }

  private makeFinishChunk(stop: StopReason): string {
    return `data: ${JSON.stringify({
      id: this.id,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta: {}, finish_reason: mapStopReason(stop) }],
    })}\n\n`;
  }
}

function mapStopReason(r: StopReason): string {
  switch (r) {
    case "end_turn": return "stop";
    case "max_tokens": return "length";
    case "stop_sequence": return "stop";
    case "tool_use": return "tool_calls";
    case "error": return "content_filter";
  }
}
