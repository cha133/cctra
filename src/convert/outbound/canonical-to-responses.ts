// ============================================================================
// Canonical → OpenAI Responses API 响应
// 输出 message (output_text/refusal) + function_call + reasoning 块
// 跳过：5 个内置工具调用（Canonical 不承载）
// ============================================================================
import type { CanonicalResponse, CanonicalContentBlock } from "../../canonical/types";

type MessageContent =
  | { type: "output_text"; text: string }
  | { type: "refusal"; refusal: string };

type ResponsesOutput =
  | { type: "message"; id?: string; role: "assistant"; content: MessageContent[] }
  | { type: "function_call"; id: string; name: string; arguments: string; call_id: string }
  | { type: "reasoning"; id: string; summary: Array<{ type: "summary_text"; text: string }> };

interface ResponsesResponse {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  status: "completed" | "incomplete" | "failed";
  output: ResponsesOutput[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export function canonicalToResponsesResponse(res: CanonicalResponse): ResponsesResponse {
  const output: ResponsesOutput[] = [];

  // 把所有 text + refusal 合并成一个 message item
  const messageContent: MessageContent[] = [];
  for (const b of res.content) {
    if (b.type === "text" && b.text) {
      messageContent.push({ type: "output_text", text: b.text });
    } else if (b.type === "refusal") {
      messageContent.push({ type: "refusal", refusal: b.refusal });
    }
  }
  if (messageContent.length > 0) {
    output.push({ type: "message", id: `msg_${res.id}`, role: "assistant", content: messageContent });
  }

  // tool_use → function_call
  for (const b of res.content) {
    if (b.type === "tool_use") {
      output.push({
        type: "function_call",
        id: b.id,
        name: b.name,
        arguments: typeof b.input === "string" ? b.input : JSON.stringify(b.input ?? {}),
        call_id: b.id,
      });
    }
  }

  // thinking → reasoning summary
  let reasoningSeq = 0;
  for (const b of res.content) {
    if (b.type === "thinking" && b.thinking) {
      output.push({
        type: "reasoning",
        id: `rs_${res.id}_${reasoningSeq++}`,
        summary: [{ type: "summary_text", text: b.thinking }],
      });
    }
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

// 现在不用了，但保留 reference（旧测试可能 import）
export function _extractText(blocks: CanonicalContentBlock[]): string {
  return blocks.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("");
}
