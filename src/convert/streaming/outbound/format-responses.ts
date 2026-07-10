// ============================================================================
// CanonicalChunk → OpenAI Responses SSE 流式输出格式化
// ---------------------------------------------------------------------------
// Responses 事件是带状态的生命周期：item / content part 的 done 事件以及
// response.completed 都必须携带已经聚合的完整对象，不能只发索引。
// ============================================================================

import type { CanonicalChunk, CanonicalUsage } from "../../../canonical/types";

type BlockKind = "text" | "tool_use" | "thinking";
type OutputItem = Record<string, unknown>;

interface BlockMeta {
  kind: BlockKind;
  itemId: string;
  name?: string;
  callId?: string;
  value: string;
}

export class ResponsesStreamFormatter {
  private id = `resp_${Date.now()}`;
  private model = "";
  private readonly createdAt = Math.floor(Date.now() / 1000);
  private sequenceNumber = 0;
  private blocks = new Map<number, BlockMeta>();
  private outputItems = new Map<number, OutputItem>();
  private usage: CanonicalUsage = { inputTokens: 0, outputTokens: 0 };
  // 流中错已发 error event：抑制 response.completed（避免"错 + 完成"矛盾信号）
  private streamEndedWithError = false;

  format(chunk: CanonicalChunk): string[] {
    switch (chunk.type) {
      case "message_start": {
        if (chunk.message.id) this.id = chunk.message.id;
        if (chunk.message.model) this.model = chunk.message.model;
        this.usage = { ...chunk.message.usage };
        const response = this.makeResponse("in_progress", [], null);
        return [
          this.event({ type: "response.created", response }),
          this.event({ type: "response.in_progress", response }),
        ];
      }

      case "content_block_start": {
        const block = chunk.content_block;
        if (block.type === "text") {
          const meta: BlockMeta = { kind: "text", itemId: `msg_${chunk.index}`, value: block.text };
          this.blocks.set(chunk.index, meta);
          const item = this.textItem(meta.itemId, "in_progress", "");
          return [
            this.event({
              type: "response.output_item.added",
              output_index: chunk.index,
              item,
            }),
            this.event({
              type: "response.content_part.added",
              item_id: meta.itemId,
              output_index: chunk.index,
              content_index: 0,
              part: this.outputTextPart(""),
            }),
          ];
        }
        if (block.type === "tool_use") {
          const meta: BlockMeta = {
            kind: "tool_use",
            itemId: `fc_${chunk.index}`,
            callId: block.id,
            name: block.name,
            value: "",
          };
          this.blocks.set(chunk.index, meta);
          return [this.event({
            type: "response.output_item.added",
            output_index: chunk.index,
            item: this.toolItem(meta, "in_progress"),
          })];
        }
        if (block.type === "thinking") {
          const meta: BlockMeta = { kind: "thinking", itemId: `rs_${chunk.index}`, value: block.thinking };
          this.blocks.set(chunk.index, meta);
          return [
            this.event({
              type: "response.output_item.added",
              output_index: chunk.index,
              item: this.reasoningItem(meta.itemId, ""),
            }),
            this.event({
              type: "response.reasoning_summary_part.added",
              item_id: meta.itemId,
              output_index: chunk.index,
              summary_index: 0,
              part: { type: "summary_text", text: "" },
            }),
          ];
        }
        // image / document / tool_result / refusal：当前 canonical 流不会生成这些 block。
        return [];
      }

      case "content_block_delta": {
        const meta = this.blocks.get(chunk.index);
        if (!meta) return [];
        if (chunk.delta.type === "text_delta" && meta.kind === "text") {
          meta.value += chunk.delta.text;
          return [this.event({
            type: "response.output_text.delta",
            item_id: meta.itemId,
            output_index: chunk.index,
            content_index: 0,
            delta: chunk.delta.text,
          })];
        }
        if (chunk.delta.type === "input_json_delta" && meta.kind === "tool_use") {
          meta.value += chunk.delta.partial_json;
          return [this.event({
            type: "response.function_call_arguments.delta",
            item_id: meta.itemId,
            output_index: chunk.index,
            delta: chunk.delta.partial_json,
          })];
        }
        if (chunk.delta.type === "thinking_delta" && meta.kind === "thinking") {
          meta.value += chunk.delta.thinking;
          return [this.event({
            type: "response.reasoning_summary_text.delta",
            item_id: meta.itemId,
            output_index: chunk.index,
            summary_index: 0,
            delta: chunk.delta.thinking,
          })];
        }
        // signature_delta → Responses 无对应。
        return [];
      }

      case "content_block_stop": {
        const meta = this.blocks.get(chunk.index);
        if (!meta) return [];
        this.blocks.delete(chunk.index);

        if (meta.kind === "text") {
          const part = this.outputTextPart(meta.value);
          const item = this.textItem(meta.itemId, "completed", meta.value);
          this.outputItems.set(chunk.index, item);
          return [
            this.event({
              type: "response.output_text.done",
              item_id: meta.itemId,
              output_index: chunk.index,
              content_index: 0,
              text: meta.value,
            }),
            this.event({
              type: "response.content_part.done",
              item_id: meta.itemId,
              output_index: chunk.index,
              content_index: 0,
              part,
            }),
            this.event({ type: "response.output_item.done", output_index: chunk.index, item }),
          ];
        }

        if (meta.kind === "tool_use") {
          const item = this.toolItem(meta, "completed");
          this.outputItems.set(chunk.index, item);
          return [
            this.event({
              type: "response.function_call_arguments.done",
              item_id: meta.itemId,
              output_index: chunk.index,
              name: meta.name,
              arguments: meta.value,
            }),
            this.event({ type: "response.output_item.done", output_index: chunk.index, item }),
          ];
        }

        const part = { type: "summary_text", text: meta.value };
        const item = this.reasoningItem(meta.itemId, meta.value);
        this.outputItems.set(chunk.index, item);
        return [
          this.event({
            type: "response.reasoning_summary_text.done",
            item_id: meta.itemId,
            output_index: chunk.index,
            summary_index: 0,
            text: meta.value,
          }),
          this.event({
            type: "response.reasoning_summary_part.done",
            item_id: meta.itemId,
            output_index: chunk.index,
            summary_index: 0,
            part,
          }),
          this.event({ type: "response.output_item.done", output_index: chunk.index, item }),
        ];
      }

      case "message_delta":
        if (chunk.usage) this.usage = { ...this.usage, ...chunk.usage };
        return [];

      case "message_stop": {
        if (this.streamEndedWithError) return [];
        const output = [...this.outputItems.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, item]) => item);
        return [this.event({
          type: "response.completed",
          response: this.makeResponse("completed", output, this.responsesUsage()),
        })];
      }

      case "ping":
        return [];

      case "error":
        this.streamEndedWithError = true;
        return [this.event({ type: "response.error", error: { message: chunk.error } })];
    }
  }

  private event(payload: Record<string, unknown>): string {
    const type = payload.type;
    if (typeof type !== "string") throw new Error("Responses SSE event is missing type");
    const body = { ...payload, sequence_number: this.sequenceNumber++ };
    return `event: ${type}\ndata: ${JSON.stringify(body)}\n\n`;
  }

  private makeResponse(
    status: "in_progress" | "completed",
    output: OutputItem[],
    usage: Record<string, unknown> | null,
  ): Record<string, unknown> {
    return {
      id: this.id,
      object: "response",
      created_at: this.createdAt,
      status,
      completed_at: status === "completed" ? Math.floor(Date.now() / 1000) : null,
      error: null,
      incomplete_details: null,
      model: this.model,
      output,
      usage,
    };
  }

  private responsesUsage(): Record<string, unknown> {
    return {
      input_tokens: this.usage.inputTokens,
      ...(this.usage.cacheReadTokens !== undefined
        ? { input_tokens_details: { cached_tokens: this.usage.cacheReadTokens } }
        : {}),
      output_tokens: this.usage.outputTokens,
      total_tokens: this.usage.inputTokens + this.usage.outputTokens,
    };
  }

  private outputTextPart(text: string): OutputItem {
    return { type: "output_text", text, annotations: [] };
  }

  private textItem(itemId: string, status: "in_progress" | "completed", text: string): OutputItem {
    return {
      id: itemId,
      type: "message",
      status,
      role: "assistant",
      content: status === "completed" ? [this.outputTextPart(text)] : [],
    };
  }

  private toolItem(meta: BlockMeta, status: "in_progress" | "completed"): OutputItem {
    return {
      id: meta.itemId,
      type: "function_call",
      status,
      call_id: meta.callId,
      name: meta.name,
      arguments: meta.value,
    };
  }

  private reasoningItem(itemId: string, text: string): OutputItem {
    return {
      id: itemId,
      type: "reasoning",
      summary: text ? [{ type: "summary_text", text }] : [],
    };
  }
}
