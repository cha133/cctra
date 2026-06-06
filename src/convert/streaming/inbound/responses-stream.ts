// ============================================================================
// OpenAI Responses SSE → CanonicalChunk 流式状态机
// ---------------------------------------------------------------------------
// 处理 12+ 种 response.* 事件：
//   - response.created                              → message_start
//   - response.output_item.added (message)          → content_block_start(text)
//   - response.output_item.added (function_call)    → content_block_start(tool_use)
//   - response.output_item.added (reasoning)        → content_block_start(thinking)
//   - response.output_text.delta                    → content_block_delta(text_delta)
//   - response.function_call_arguments.delta        → content_block_delta(input_json_delta)
//   - response.reasoning_summary_text.delta         → content_block_delta(thinking_delta)
//   - response.refusal.delta                        → content_block_delta(text_delta with prefix)
//   - response.output_item.done                     → content_block_stop
//   - response.error                                → error
//   - response.completed                            → message_delta + message_stop
//
// 内置工具（web_search/code_interpreter/file_search/mcp_call/computer_use_call）
// 在 v1 跳过：Canonical 不承载这些 block 类型。
// ============================================================================

import type { CanonicalChunk, CanonicalContentBlock, StopReason } from "../../../canonical/types";
import { parseSseStream } from "../../../server/sse";

interface ResponsesEvent {
  type?: string;
  output_index?: number;
  item_id?: string;
  delta?: string;
  item?: {
    id?: string;
    type?: string;          // "message" | "function_call" | "reasoning" | "refusal" | builtins
    name?: string;
    arguments?: string;
    call_id?: string;
    role?: string;
  };
  response?: {
    id?: string;
    model?: string;
    status?: string;
    incomplete_details?: { reason?: string };
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  error?: { message?: string; code?: string };
}

export async function* responsesStreamToCanonical(
  rawStream: ReadableStream<Uint8Array>,
): AsyncGenerator<CanonicalChunk> {
  // 状态：output_index → Canonical block_index（直接 1:1 用 output_index）
  // 同时记住每个 output_index 对应的 block kind（关掉时无需查）
  const openBlocks = new Set<number>();
  let messageStarted = false;
  let messageStopped = false;
  let upstreamModel = "";
  let upstreamId = "";

  for await (const ev of parseSseStream(rawStream)) {
    if (ev.data === "[DONE]") {
      if (!messageStopped) yield* finalize("end_turn");
      continue;
    }

    let parsed: ResponsesEvent;
    try {
      parsed = JSON.parse(ev.data) as ResponsesEvent;
    } catch {
      continue;
    }

    switch (parsed.type) {
      case "response.created": {
        if (parsed.response?.id) upstreamId = parsed.response.id;
        if (parsed.response?.model) upstreamModel = parsed.response.model;
        if (!messageStarted) {
          messageStarted = true;
          yield {
            type: "message_start",
            message: {
              id: upstreamId || `resp_${Date.now()}`,
              model: upstreamModel || "unknown",
              content: [],
              stopReason: "end_turn",
              usage: { inputTokens: 0, outputTokens: 0 },
            },
          };
        }
        break;
      }

      case "response.in_progress":
        // 状态信号，无需转发
        break;

      case "response.output_item.added": {
        const idx = parsed.output_index;
        if (idx === undefined || openBlocks.has(idx)) break;
        const block = itemToBlock(parsed.item);
        if (!block) break;
        openBlocks.add(idx);
        yield { type: "content_block_start", index: idx, content_block: block };
        break;
      }

      case "response.output_text.delta": {
        const idx = parsed.output_index;
        if (idx === undefined || typeof parsed.delta !== "string") break;
        yield {
          type: "content_block_delta",
          index: idx,
          delta: { type: "text_delta", text: parsed.delta },
        };
        break;
      }

      case "response.function_call_arguments.delta": {
        const idx = parsed.output_index;
        if (idx === undefined || typeof parsed.delta !== "string") break;
        yield {
          type: "content_block_delta",
          index: idx,
          delta: { type: "input_json_delta", partial_json: parsed.delta },
        };
        break;
      }

      case "response.function_call_arguments.done": {
        // 单独的 done 事件不发；统一由 output_item.done 关 block
        break;
      }

      case "response.reasoning_summary_part.added": {
        const idx = parsed.output_index;
        if (idx === undefined || openBlocks.has(idx)) break;
        openBlocks.add(idx);
        yield {
          type: "content_block_start",
          index: idx,
          content_block: { type: "thinking", thinking: "" },
        };
        break;
      }

      case "response.reasoning_summary_text.delta":
      case "response.reasoning.delta": {
        const idx = parsed.output_index;
        if (idx === undefined || typeof parsed.delta !== "string") break;
        yield {
          type: "content_block_delta",
          index: idx,
          delta: { type: "thinking_delta", thinking: parsed.delta },
        };
        break;
      }

      case "response.reasoning_summary_part.done": {
        const idx = parsed.output_index;
        if (idx === undefined) break;
        if (openBlocks.has(idx)) {
          openBlocks.delete(idx);
          yield { type: "content_block_stop", index: idx };
        }
        break;
      }

      case "response.refusal.delta": {
        // ContentBlockDelta 联合没有 refusal_delta；用 text_delta 加前缀承载
        const idx = parsed.output_index;
        if (idx === undefined || typeof parsed.delta !== "string") break;
        if (!openBlocks.has(idx)) {
          openBlocks.add(idx);
          yield {
            type: "content_block_start",
            index: idx,
            content_block: { type: "text", text: "" },
          };
        }
        yield {
          type: "content_block_delta",
          index: idx,
          delta: { type: "text_delta", text: `[refusal] ${parsed.delta}` },
        };
        break;
      }

      case "response.output_item.done": {
        const idx = parsed.output_index;
        if (idx === undefined) break;
        if (openBlocks.has(idx)) {
          openBlocks.delete(idx);
          yield { type: "content_block_stop", index: idx };
        }
        break;
      }

      case "response.error": {
        yield { type: "error", error: parsed.error?.message ?? "upstream_error" };
        break;
      }

      case "response.failed":
      case "response.incomplete": {
        if (!messageStopped) {
          yield* finalize(parsed.response?.incomplete_details?.reason === "max_output_tokens" ? "max_tokens" : "error");
        }
        break;
      }

      case "response.completed": {
        if (!messageStopped) {
          const usage = parsed.response?.usage;
          // 一次性把 usage 一起带在 message_delta 里
          if (usage) {
            yield* finalizeWithUsage("end_turn", usage.input_tokens ?? 0, usage.output_tokens ?? 0);
          } else {
            yield* finalize("end_turn");
          }
        }
        break;
      }

      default:
        // 内置工具事件（response.web_search_call.* / code_interpreter.* / ...）
        // v1 跳过：Canonical 不承载
        break;
    }
  }

  if (!messageStopped) yield* finalize("end_turn");

  // ---------- helpers ----------

  function itemToBlock(item: ResponsesEvent["item"]): CanonicalContentBlock | null {
    if (!item) return null;
    switch (item.type) {
      case "message":
        return { type: "text", text: "" };
      case "function_call":
        return { type: "tool_use", id: item.call_id ?? item.id ?? "", name: item.name ?? "", input: {} };
      case "reasoning":
        return { type: "thinking", thinking: "" };
      default:
        // 内置工具 / 未知类型：跳
        return null;
    }
  }

  function* finalize(stopReason: StopReason): Generator<CanonicalChunk> {
    // 关掉所有还开着的 block
    for (const idx of openBlocks) {
      yield { type: "content_block_stop", index: idx };
    }
    openBlocks.clear();
    yield { type: "message_delta", delta: { stop_reason: stopReason } };
    yield { type: "message_stop" };
    messageStopped = true;
  }

  function* finalizeWithUsage(
    stopReason: StopReason,
    inputTokens: number,
    outputTokens: number,
  ): Generator<CanonicalChunk> {
    for (const idx of openBlocks) {
      yield { type: "content_block_stop", index: idx };
    }
    openBlocks.clear();
    yield {
      type: "message_delta",
      delta: { stop_reason: stopReason },
      usage: { inputTokens, outputTokens },
    };
    yield { type: "message_stop" };
    messageStopped = true;
  }
}
