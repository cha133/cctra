// ============================================================================
// 上游响应解析：OpenAI Responses → CanonicalResponse
// 跟 upstream.ts（orchestrator）配套使用
// ============================================================================
import type { CanonicalResponse, CanonicalContentBlock, StopReason } from "../canonical/types";

interface ResponsesUpstreamResponse {
  id?: string;
  model?: string;
  status?: "completed" | "incomplete" | "failed" | string;
  output?: Array<
    | { type: "message"; role?: "assistant"; content?: Array<{ type: "output_text"; text: string } | { type: "refusal"; refusal: string }> }
    | { type: "function_call"; call_id: string; name: string; arguments: string }
    | { type: "reasoning"; summary?: Array<{ type: "summary_text"; text: string }> }
  >;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export function parseResponsesResponse(raw: unknown, model: string): CanonicalResponse {
  const r = raw as ResponsesUpstreamResponse;
  const blocks: CanonicalContentBlock[] = [];

  for (const item of r.output ?? []) {
    if (item.type === "message") {
      for (const c of item.content ?? []) {
        if (c.type === "output_text") blocks.push({ type: "text", text: c.text });
        else if (c.type === "refusal") blocks.push({ type: "refusal", refusal: c.refusal });
      }
    } else if (item.type === "function_call") {
      let input: unknown = {};
      try { input = JSON.parse(item.arguments); } catch { /* keep empty */ }
      blocks.push({ type: "tool_use", id: item.call_id, name: item.name, input });
    } else if (item.type === "reasoning") {
      const thinking = (item.summary ?? []).map((s) => s.text).join("");
      if (thinking) blocks.push({ type: "thinking", thinking });
    }
    // 跳过其他 type（reasoning_summary_text 单元素、file_citation 等）
  }

  return {
    id: r.id ?? `resp-${Date.now()}`,
    model: r.model ?? model,
    content: blocks,
    stopReason: mapStopReason(r.status),
    usage: {
      inputTokens: r.usage?.input_tokens ?? 0,
      outputTokens: r.usage?.output_tokens ?? 0,
    },
  };
}

function mapStopReason(s: string | undefined): StopReason {
  switch (s) {
    case "completed": return "end_turn";
    case "incomplete": return "max_tokens";
    case "failed": return "error";
    default: return "end_turn";
  }
}
