// ============================================================================
// CanonicalChunk → OpenAI Responses SSE 流式输出格式化
// ---------------------------------------------------------------------------
// 关键状态：
//   - 每个 Canonical block 对应一个 Responses output_index（直接复用 index）
//   - 关 stop 时按 block kind 分发：
//       text     → response.output_item.done
//       tool_use → response.function_call_arguments.done + response.output_item.done
//       thinking → response.reasoning_summary_part.done + response.output_item.done
//   - signature_delta 丢（Responses 无对应）
// ============================================================================

import type { CanonicalChunk } from "../../../canonical/types";

type BlockKind = "text" | "tool_use" | "thinking";

interface BlockMeta {
  kind: BlockKind;
  id?: string;
  name?: string;
}

export class ResponsesStreamFormatter {
  private id = `resp_${Date.now()}`;
  private model = "";
  private blocks = new Map<number, BlockMeta>();

  format(chunk: CanonicalChunk): string[] {
    switch (chunk.type) {
      case "message_start": {
        if (chunk.message.id) this.id = chunk.message.id;
        if (chunk.message.model) this.model = chunk.message.model;
        return [event({
          type: "response.created",
          response: {
            id: this.id,
            object: "response",
            model: this.model,
            status: "in_progress",
            output: [],
          },
        })];
      }

      case "content_block_start": {
        const block = chunk.content_block;
        if (block.type === "text") {
          this.blocks.set(chunk.index, { kind: "text" });
          return [event({
            type: "response.output_item.added",
            output_index: chunk.index,
            item: {
              type: "message",
              id: `msg_${chunk.index}`,
              status: "in_progress",
              role: "assistant",
              content: [],
            },
          })];
        }
        if (block.type === "tool_use") {
          this.blocks.set(chunk.index, { kind: "tool_use", id: block.id, name: block.name });
          return [event({
            type: "response.output_item.added",
            output_index: chunk.index,
            item: {
              type: "function_call",
              id: `fc_${chunk.index}`,
              status: "in_progress",
              call_id: block.id,
              name: block.name,
              arguments: "",
            },
          })];
        }
        if (block.type === "thinking") {
          this.blocks.set(chunk.index, { kind: "thinking" });
          return [
            event({
              type: "response.output_item.added",
              output_index: chunk.index,
              item: { type: "reasoning", id: `rs_${chunk.index}`, summary: [] },
            }),
            event({
              type: "response.reasoning_summary_part.added",
              output_index: chunk.index,
              summary_index: 0,
              part: { type: "summary_text", text: "" },
            }),
          ];
        }
        // image / document / tool_result / refusal: 流式上下文很少出现，跳
        return [];
      }

      case "content_block_delta": {
        if (chunk.delta.type === "text_delta") {
          return [event({
            type: "response.output_text.delta",
            output_index: chunk.index,
            delta: chunk.delta.text,
          })];
        }
        if (chunk.delta.type === "input_json_delta") {
          return [event({
            type: "response.function_call_arguments.delta",
            output_index: chunk.index,
            delta: chunk.delta.partial_json,
          })];
        }
        if (chunk.delta.type === "thinking_delta") {
          return [event({
            type: "response.reasoning_summary_text.delta",
            output_index: chunk.index,
            summary_index: 0,
            delta: chunk.delta.thinking,
          })];
        }
        // signature_delta → Responses 无对应，丢
        return [];
      }

      case "content_block_stop": {
        const meta = this.blocks.get(chunk.index);
        this.blocks.delete(chunk.index);
        if (!meta) {
          return [event({ type: "response.output_item.done", output_index: chunk.index })];
        }
        if (meta.kind === "tool_use") {
          return [
            event({
              type: "response.function_call_arguments.done",
              output_index: chunk.index,
            }),
            event({ type: "response.output_item.done", output_index: chunk.index }),
          ];
        }
        if (meta.kind === "thinking") {
          return [
            event({
              type: "response.reasoning_summary_part.done",
              output_index: chunk.index,
              summary_index: 0,
            }),
            event({ type: "response.output_item.done", output_index: chunk.index }),
          ];
        }
        // text
        return [event({ type: "response.output_item.done", output_index: chunk.index })];
      }

      case "message_delta":
        // Responses 在 completed 一次性发 usage，中间不需要
        return [];

      case "message_stop": {
        return [
          event({
            type: "response.completed",
            response: { id: this.id, model: this.model, status: "completed" },
          }),
          "data: [DONE]\n\n",
        ];
      }

      case "ping":
        return [];

      case "error":
        return [event({ type: "response.error", error: { message: chunk.error } })];
    }
  }
}

function event(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
