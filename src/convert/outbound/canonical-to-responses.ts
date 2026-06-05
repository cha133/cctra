// ============================================================================
// Canonical → OpenAI Responses API 响应
// v1 简化版：只输出 output_text 和 function_call 块
// ============================================================================
import type { CanonicalResponse, CanonicalContentBlock } from "../../canonical/types";

interface ResponsesResponse {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  status: "completed" | "incomplete" | "failed";
  output: Array<
    | { type: "message"; role: "assistant"; content: Array<{ type: "output_text"; text: string }> }
    | { type: "function_call"; id: string; name: string; arguments: string; call_id: string }
  >;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export function canonicalToResponsesResponse(res: CanonicalResponse): ResponsesResponse {
  const text = extractText(res.content);
  const toolUses = res.content.filter((b): b is { type: "tool_use"; id: string; name: string; input: unknown } => b.type === "tool_use");

  const output: ResponsesResponse["output"] = [];
  if (text) {
    output.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    });
  }
  for (const u of toolUses) {
    output.push({
      type: "function_call",
      id: u.id,
      name: u.name,
      arguments: typeof u.input === "string" ? u.input : JSON.stringify(u.input ?? {}),
      call_id: u.id,
    });
  }

  return {
    id: res.id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: res.model,
    status: res.stopReason === "error" ? "failed" : "completed",
    output,
    usage: {
      input_tokens: res.usage.inputTokens,
      output_tokens: res.usage.outputTokens,
      total_tokens: res.usage.inputTokens + res.usage.outputTokens,
    },
  };
}

function extractText(blocks: CanonicalContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}
