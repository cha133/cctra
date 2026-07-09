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

import type { CanonicalChunk, CanonicalRequest, CanonicalTool } from "../../../canonical/types";

/** Responses API 格式的 tool 定义 */
function toolToResponses(t: CanonicalTool): Record<string, unknown> {
  return { type: "function", name: t.name, description: t.description, parameters: t.inputSchema };
}

type BlockKind = "text" | "tool_use" | "thinking";

interface BlockMeta {
  kind: BlockKind;
  id?: string;
  name?: string;
  /** 文本块累积的内容 / function_call 累积的 arguments / thinking 累积的 summary */
  accumulated?: string;
}

export class ResponsesStreamFormatter {
  /** Responses API 响应 ID（resp_ 前缀，与官方格式一致） */
  private id = `resp_${Date.now()}`;
  /** 上游 message id（用于 message block id 等） */
  private upstreamId = "";
  private model = "";
  /** 来自请求的工具定义（已转换为 Responses API 格式），用于 response.created/response.completed */
  private requestTools?: Record<string, unknown>[];
  private requestInstructions?: string;
  private requestTemperature?: number;
  private requestMaxTokens?: number;
  private requestTopP?: number;
  private requestReasoning?: CanonicalRequest["reasoning"];
  private blocks = new Map<number, BlockMeta>();
  /** 已完成 output items，用于 response.completed 的 output 数组 */
  private outputItems: Record<string, unknown>[] = [];
  /** 上游 usage（来自 message_delta），用于 response.completed */
  private usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number } = {};
  // 流中错已发 error event：抑制 response.completed + [DONE]（避免"错 + 完成"矛盾信号）
  private _streamEndedWithError = false;

  constructor(opts?: {
    tools?: NonNullable<CanonicalRequest["tools"]>;
    instructions?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    reasoning?: CanonicalRequest["reasoning"];
  }) {
    this.requestTools = opts?.tools?.map(toolToResponses);
    this.requestInstructions = opts?.instructions;
    this.requestTemperature = opts?.temperature;
    this.requestMaxTokens = opts?.maxTokens;
    this.requestTopP = opts?.topP;
    this.requestReasoning = opts?.reasoning;
  }

  format(chunk: CanonicalChunk): string[] {
    switch (chunk.type) {
      case "message_start": {
        if (chunk.message.id) this.upstreamId = chunk.message.id;
        if (chunk.message.model) this.model = chunk.message.model;
        const respBase = {
          id: this.id,
          object: "response",
          created_at: Math.floor(Date.now() / 1000),
          model: this.model,
          status: "in_progress",
          output: [],
          ...(this.requestTools ? { tools: this.requestTools } : {}),
          ...(this.requestInstructions ? { instructions: this.requestInstructions } : {}),
          ...(this.requestTemperature !== undefined ? { temperature: this.requestTemperature } : {}),
          ...(this.requestMaxTokens !== undefined ? { max_output_tokens: this.requestMaxTokens } : {}),
          ...(this.requestTopP !== undefined ? { top_p: this.requestTopP } : {}),
          ...(this.requestReasoning ? { reasoning: this.requestReasoning } : {}),
        };
        return [
          event("response.created", { response: respBase }),
          event("response.in_progress", { response: { id: this.id, object: "response", status: "in_progress" } }),
        ];
      }

      case "content_block_start": {
        const block = chunk.content_block;
        if (block.type === "text") {
          this.blocks.set(chunk.index, { kind: "text" });
          return [event("response.output_item.added", {
            output_index: chunk.index,
            item: {
              type: "message",
              id: `msg_${this.upstreamId || this.id}`,
              status: "in_progress",
              role: "assistant",
              content: [],
            },
          })];
        }
        if (block.type === "tool_use") {
          this.blocks.set(chunk.index, { kind: "tool_use", id: block.id, name: block.name });
          return [event("response.output_item.added", {
            output_index: chunk.index,
            item: {
              type: "function_call",
              id: block.id,
              status: "in_progress",
              call_id: block.id,
              name: block.name,
            },
          })];
        }
        if (block.type === "thinking") {
          this.blocks.set(chunk.index, { kind: "thinking" });
          return [
            event("response.output_item.added", {
              output_index: chunk.index,
              item: { type: "reasoning", id: `rs_${this.upstreamId || this.id}`, summary: [] },
            }),
            event("response.reasoning_summary_part.added", {
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
          const meta = this.blocks.get(chunk.index);
          if (meta) meta.accumulated = (meta.accumulated ?? "") + chunk.delta.text;
          return [event("response.output_text.delta", {
            output_index: chunk.index,
            delta: chunk.delta.text,
          })];
        }
        if (chunk.delta.type === "input_json_delta") {
          const meta = this.blocks.get(chunk.index);
          if (meta) meta.accumulated = (meta.accumulated ?? "") + chunk.delta.partial_json;
          return [event("response.function_call_arguments.delta", {
            output_index: chunk.index,
            item_id: meta?.id ?? "",
            delta: chunk.delta.partial_json,
          })];
        }
        if (chunk.delta.type === "thinking_delta") {
          const meta = this.blocks.get(chunk.index);
          if (meta) meta.accumulated = (meta.accumulated ?? "") + chunk.delta.thinking;
          return [event("response.reasoning_summary_text.delta", {
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
          return [event("response.output_item.done", { output_index: chunk.index })];
        }
        if (meta.kind === "tool_use") {
          this.outputItems.push({
            type: "function_call",
            id: meta.id,
            status: "completed",
            call_id: meta.id,
            name: meta.name,
            arguments: meta.accumulated ?? "",
          });
          return [
            event("response.function_call_arguments.done", {
              output_index: chunk.index,
              item_id: meta.id,
              arguments: meta.accumulated ?? "",
            }),
            event("response.output_item.done", {
              output_index: chunk.index,
              item: {
                type: "function_call",
                id: meta.id,
                status: "completed",
                call_id: meta.id,
                name: meta.name,
                arguments: meta.accumulated ?? "",
              },
            }),
          ];
        }
        if (meta.kind === "thinking") {
          this.outputItems.push({
            type: "reasoning",
            id: `rs_${this.upstreamId || this.id}`,
            summary: [{ type: "summary_text", text: meta.accumulated ?? "" }],
          });
          return [
            event("response.reasoning_summary_part.done", {
              output_index: chunk.index,
              summary_index: 0,
            }),
            event("response.output_item.done", {
              output_index: chunk.index,
              item: {
                type: "reasoning",
                id: `rs_${this.upstreamId || this.id}`,
                summary: [{ type: "summary_text", text: meta.accumulated ?? "" }],
              },
            }),
          ];
        }
        // text
        this.outputItems.push({
          type: "message",
          id: `msg_${this.upstreamId || this.id}`,
          role: "assistant",
          content: [{ type: "output_text", text: meta.accumulated ?? "" }],
        });
        return [event("response.output_item.done", {
          output_index: chunk.index,
          item: {
            type: "message",
            id: `msg_${this.upstreamId || this.id}`,
            role: "assistant",
            content: [{ type: "output_text", text: meta.accumulated ?? "" }],
          },
        })];
      }

      case "message_delta": {
        // 累积 usage 供 message_stop 使用
        if (chunk.usage) {
          const i = chunk.usage.inputTokens ?? 0;
          const o = chunk.usage.outputTokens ?? 0;
          this.usage = { input_tokens: i, output_tokens: o, total_tokens: i + o };
        }
        return [];
      }

      case "message_stop": {
        // 流中错时抑制 response.completed + [DONE]（cc-switch 二元化约束）
        if (this._streamEndedWithError) return [];
        return [
          event("response.completed", {
            response: {
              id: this.id,
              object: "response",
              created_at: Math.floor(Date.now() / 1000),
              model: this.model,
              status: "completed",
              output: this.outputItems,
              ...(this.requestTools ? { tools: this.requestTools } : {}),
              ...(this.requestInstructions ? { instructions: this.requestInstructions } : {}),
              ...(this.requestTemperature !== undefined ? { temperature: this.requestTemperature } : {}),
              ...(this.requestMaxTokens !== undefined ? { max_output_tokens: this.requestMaxTokens } : {}),
              ...(this.requestTopP !== undefined ? { top_p: this.requestTopP } : {}),
              ...(this.requestReasoning ? { reasoning: this.requestReasoning } : {}),
              ...(this.usage.input_tokens !== undefined ? { usage: this.usage } : {}),
            },
          }),
          "data: [DONE]\n\n",
        ];
      }

      case "ping":
        return [];

      case "error": {
        // 流中错：发 error event + 设抑制标志
        this._streamEndedWithError = true;
        return [event("response.error", { error: { message: chunk.error } })];
      }
    }
  }
}

/**
 * SSE event 行格式化：event: {type}\ndata: {json}\n\n
 * Codex 依赖 event: 前缀来分派事件（见 xf-yun.com 工作样例）。
 */
function event(type: string, payload: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ ...payload, type })}\n\n`;
}
