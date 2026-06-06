// ============================================================================
// 上游响应解析：OpenAI Chat Completions → CanonicalResponse
// 跟 upstream.ts（orchestrator）配套使用
// ============================================================================
import type { CanonicalResponse, CanonicalContentBlock } from "../canonical/types";

interface ChatUpstreamResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message: {
      role: "assistant";
      content?: string | null;
      tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export function parseChatUpstreamResponse(raw: unknown, model: string): CanonicalResponse {
  const r = raw as ChatUpstreamResponse;
  const choice = r.choices?.[0];
  if (!choice) {
    return makeErrorResponse(model, "no_choices", { type: "parse_error" });
  }

  const blocks: CanonicalContentBlock[] = [];
  if (choice.message.content) {
    blocks.push({ type: "text", text: choice.message.content });
  }
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input: unknown = {};
      try { input = JSON.parse(tc.function.arguments); } catch { /* keep empty */ }
      blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
    }
  }

  return {
    id: r.id ?? `chatcmpl-${Date.now()}`,
    model: r.model ?? model,
    content: blocks,
    stopReason: mapStopReason(choice.finish_reason),
    usage: {
      inputTokens: r.usage?.prompt_tokens ?? 0,
      outputTokens: r.usage?.completion_tokens ?? 0,
    },
  };
}

function mapStopReason(r: string | undefined): CanonicalResponse["stopReason"] {
  switch (r) {
    case "stop": return "end_turn";
    case "length": return "max_tokens";
    case "tool_calls": return "tool_use";
    case "content_filter": return "error";
    default: return "end_turn";
  }
}

function makeErrorResponse(
  model: string,
  reason: string,
  opts?: { type?: "parse_error" },
): CanonicalResponse {
  const message = `Upstream returned no valid response: ${reason}`;
  const base: CanonicalResponse = {
    id: `error-${Date.now()}`,
    model,
    content: [{ type: "text", text: message }],
    stopReason: "error",
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  if (!opts?.type) return base;
  return { ...base, error: { message, type: opts.type } };
}
