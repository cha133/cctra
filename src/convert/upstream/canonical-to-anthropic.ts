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
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64" | "url"; media_type: string; data?: string; url?: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

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
  };
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
      // 透传 thinking（如果有 signature）
      return { type: "text", text: b.thinking }; // 简化：thinking 转 text
    case "document":
      // v1 简化：document 暂时转成 text
      return { type: "text", text: `[document: ${b.source.kind === "url" ? b.source.data : "base64 data"}]` };
  }
}
