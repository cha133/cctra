// ============================================================================
// OpenAI Chat Completions SSE → CanonicalChunk 流式状态机
// ---------------------------------------------------------------------------
// 处理：
//   - delta.role 首次出现 → message_start
//   - delta.content 首次/累积 → content_block_start(text) + content_block_delta(text_delta)
//   - delta.tool_calls[i] 多 chunk 拼接 → content_block_start(tool_use) + input_json_delta
//   - finish_reason 非 null → 关掉所有打开的 block + message_delta + message_stop
//   - [DONE] → 安全收尾（idempotent）
// ============================================================================

import type { CanonicalChunk, StopReason } from "../../../canonical/types";
import { parseSseStream } from "../../../server/sse";

interface PendingTool {
  id: string;
  name: string;
  blockIndex: number;
  emittedStart: boolean;
}

interface ChatStreamChunk {
  id?: string;
  model?: string;
  choices?: Array<{
    delta?: {
      role?: string;
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function* chatStreamToCanonical(
  rawStream: ReadableStream<Uint8Array>,
): AsyncGenerator<CanonicalChunk> {
  // ---------- 状态 ----------
  const pendingTools = new Map<number, PendingTool>();   // key = OpenAI tool_call index
  let nextBlockIndex = 0;
  let textBlockIndex: number | null = null;              // 0 通常；null 表示还没开 text block
  let messageStarted = false;
  let messageStopped = false;
  let upstreamModel = "";
  let upstreamId = "";

  // ---------- 主循环 ----------
  for await (const ev of parseSseStream(rawStream)) {
    if (ev.data === "[DONE]") {
      if (!messageStopped) {
        yield* closeAll();
      }
      continue;
    }

    let parsed: ChatStreamChunk & { error?: { message?: unknown } };
    try {
      parsed = JSON.parse(ev.data) as ChatStreamChunk & { error?: { message?: unknown } };
    } catch {
      continue;
    }

    // 流中错：上游 SSE 内嵌 {error: {message}} 时透传为 canonical error chunk
    if (parsed.error && typeof parsed.error.message === "string") {
      yield { type: "error", error: parsed.error.message };
      continue;
    }

    if (parsed.id) upstreamId = parsed.id;
    if (parsed.model) upstreamModel = parsed.model;

    const choice = parsed.choices?.[0];
    if (!choice) {
      // 可能是 usage-only chunk
      if (parsed.usage && messageStarted && !messageStopped) {
        yield {
          type: "message_delta",
          delta: {},
          usage: {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
          },
        };
      }
      continue;
    }

    const delta = choice.delta;

    // (1) delta.role 首次 → message_start
    if (delta?.role && !messageStarted) {
      yield* emitMessageStart();
    }

    // (2) reasoning_content 增量（DeepSeek 等推理模型的思考阶段）
    // 映射为 text block 输出，前缀 [thinking] 标识，确保思考阶段也有数据产出
    // 防止上游长时间只发 reasoning_content 而 cctra 不产出 chunk 导致连接断开
    if (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0) {
      if (!messageStarted) yield* emitMessageStart();
      if (textBlockIndex === null) {
        textBlockIndex = nextBlockIndex++;
        yield {
          type: "content_block_start",
          index: textBlockIndex,
          content_block: { type: "text", text: "" },
        };
      }
      yield {
        type: "content_block_delta",
        index: textBlockIndex,
        delta: { type: "text_delta", text: delta.reasoning_content },
      };
    }

    // (3) text 增量
    if (typeof delta?.content === "string" && delta.content.length > 0) {
      if (!messageStarted) yield* emitMessageStart();
      if (textBlockIndex === null) {
        textBlockIndex = nextBlockIndex++;
        yield {
          type: "content_block_start",
          index: textBlockIndex,
          content_block: { type: "text", text: "" },
        };
      }
      yield {
        type: "content_block_delta",
        index: textBlockIndex,
        delta: { type: "text_delta", text: delta.content },
      };
    }

    // (3) tool_calls 增量
    if (delta?.tool_calls) {
      if (!messageStarted) yield* emitMessageStart();
      for (const tc of delta.tool_calls) {
        let pending = pendingTools.get(tc.index);
        if (!pending) {
          // 第一次见这个 index：分配 blockIndex
          pending = {
            id: tc.id ?? "",
            name: tc.function?.name ?? "",
            blockIndex: nextBlockIndex++,
            emittedStart: false,
          };
          pendingTools.set(tc.index, pending);
        } else {
          // 后续可能补 id 或 name（少见但要兼容）
          if (tc.id && !pending.id) pending.id = tc.id;
          if (tc.function?.name && !pending.name) pending.name = tc.function.name;
        }

        // 当 id 已知就可以 emit start（OpenAI 通常第一条 delta 同时有 id 和 name）
        if (!pending.emittedStart && pending.id) {
          pending.emittedStart = true;
          yield {
            type: "content_block_start",
            index: pending.blockIndex,
            content_block: { type: "tool_use", id: pending.id, name: pending.name, input: {} },
          };
        }

        // arguments 增量
        const argsPartial = tc.function?.arguments;
        if (typeof argsPartial === "string" && argsPartial.length > 0 && pending.emittedStart) {
          yield {
            type: "content_block_delta",
            index: pending.blockIndex,
            delta: { type: "input_json_delta", partial_json: argsPartial },
          };
        }
      }
    }

    // (4) finish_reason → 关掉所有 block + message_delta + message_stop
    if (choice.finish_reason) {
      yield* closeAll(choice.finish_reason);
    }
  }

  // 流自然结束但没收到 [DONE] / finish_reason
  if (!messageStopped) yield* closeAll();

  // ---------- helpers (内嵌 generator，共享闭包状态) ----------

  function* emitMessageStart(): Generator<CanonicalChunk> {
    if (messageStarted) return;
    messageStarted = true;
    yield {
      type: "message_start",
      message: {
        id: upstreamId || `msg_${Date.now()}`,
        model: upstreamModel || "unknown",
        content: [],
        stopReason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    };
  }

  function* closeAll(finishReason?: string): Generator<CanonicalChunk> {
    if (messageStopped) return;
    // 关 text block
    if (textBlockIndex !== null) {
      yield { type: "content_block_stop", index: textBlockIndex };
      textBlockIndex = null;
    }
    // 关所有 pending tool_use block
    for (const t of pendingTools.values()) {
      if (t.emittedStart) {
        yield { type: "content_block_stop", index: t.blockIndex };
      }
    }
    pendingTools.clear();

    yield {
      type: "message_delta",
      delta: { stop_reason: mapStopReason(finishReason) },
    };
    yield { type: "message_stop" };
    messageStopped = true;
  }
}

function mapStopReason(r: string | undefined): StopReason {
  switch (r) {
    case "stop": return "end_turn";
    case "length": return "max_tokens";
    case "tool_calls": return "tool_use";
    case "content_filter": return "error";
    default: return "end_turn";
  }
}
