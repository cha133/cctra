// ============================================================================
// Canonical → OpenAI Chat Completions 响应
// ============================================================================
import type { CanonicalResponse, CanonicalContentBlock } from "../../canonical/types";

interface ChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export function canonicalToChatResponse(res: CanonicalResponse): ChatResponse {
  const text = extractText(res.content);
  const toolUses = res.content.filter((b): b is { type: "tool_use"; id: string; name: string; input: unknown } => b.type === "tool_use");

  const message: ChatResponse["choices"][number]["message"] = {
    role: "assistant",
    content: text || null,
  };
  if (toolUses.length > 0) {
    message.tool_calls = toolUses.map((u) => ({
      id: u.id,
      type: "function",
      function: {
        name: u.name,
        arguments: typeof u.input === "string" ? u.input : JSON.stringify(u.input ?? {}),
      },
    }));
  }

  return {
    id: res.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: res.model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapStopReason(res.stopReason),
      },
    ],
    usage: {
      prompt_tokens: res.usage.inputTokens,
      completion_tokens: res.usage.outputTokens,
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

function mapStopReason(r: CanonicalResponse["stopReason"]): ChatResponse["choices"][number]["finish_reason"] {
  switch (r) {
    case "end_turn": return "stop";
    case "max_tokens": return "length";
    case "tool_use": return "tool_calls";
    case "stop_sequence": return "stop";
    case "error": return "content_filter";
  }
}
