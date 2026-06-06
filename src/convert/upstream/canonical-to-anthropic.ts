// ============================================================================
// Canonical → Anthropic Messages 请求（发给 Anthropic 上游用）
// ============================================================================
import type { CanonicalRequest, CanonicalContentBlock } from "../../canonical/types";

interface AnthropicUpstreamRequest {
  model: string;
  system?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string | Array<AnthropicContentBlock>;
  }>;
  tools?: Array<{ name: string; description?: string; input_schema: Record<string, unknown> }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream: boolean;
  // 让 Anthropic thinking 模型按 effort 估算预算（粗略映射）
  thinking?: { type: "enabled"; budget_tokens: number };
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64" | "url"; media_type: string; data?: string; url?: string } }
  | { type: "document"; source: { type: "base64" | "url"; media_type: string; data?: string; url?: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  | { type: "thinking"; thinking: string; signature?: string };

export function canonicalToAnthropicUpstream(req: CanonicalRequest): AnthropicUpstreamRequest {
  const messages: AnthropicUpstreamRequest["messages"] = req.messages.map((m) => ({
    role: m.role,
    content: m.content.length === 1 && m.content[0]?.type === "text"
      ? m.content[0].text
      : m.content.map(blockToAnthropic),
  }));

  let system: string | undefined;
  if (typeof req.system === "string") system = req.system;
  else if (Array.isArray(req.system)) system = req.system.map((b) => b.type === "text" ? b.text : "").join("");

  return {
    model: req.model,
    system,
    messages,
    tools: req.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
    max_tokens: req.maxTokens,
    temperature: req.temperature,
    top_p: req.topP,
    stop_sequences: req.stopSequences,
    stream: req.stream,
    thinking: req.reasoning?.effort ? { type: "enabled", budget_tokens: effortToBudget(req.reasoning.effort) } : undefined,
  };
}

function effortToBudget(effort: "low" | "medium" | "high"): number {
  switch (effort) {
    case "low": return 1024;
    case "medium": return 4096;
    case "high": return 16_384;
  }
}

function blockToAnthropic(b: CanonicalContentBlock): AnthropicContentBlock {
  switch (b.type) {
    case "text":
      return { type: "text", text: b.text };
    case "image": {
      const src = b.source;
      if (src.kind === "base64") return { type: "image", source: { type: "base64", media_type: src.mediaType, data: src.data } };
      return { type: "image", source: { type: "url", media_type: src.mediaType, url: src.data } };
    }
    case "document": {
      const src = b.source;
      if (src.kind === "base64") return { type: "document", source: { type: "base64", media_type: src.mediaType, data: src.data } };
      return { type: "document", source: { type: "url", media_type: src.mediaType, url: src.data } };
    }
    case "tool_use":
      return { type: "tool_use", id: b.id, name: b.name, input: b.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: b.toolUseId,
        content: typeof b.content === "string" ? b.content : b.content.map((cb) => cb.type === "text" ? cb.text : "").join(""),
        is_error: b.isError,
      };
    case "thinking":
      // 原生 thinking block + 透传 signature（如果有）
      return { type: "thinking", thinking: b.thinking, ...(b.signature ? { signature: b.signature } : {}) };
    case "refusal":
      // Anthropic 无 refusal block；降级为加前缀的 text
      return { type: "text", text: `[refusal] ${b.refusal}` };
  }
}
