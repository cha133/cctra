// ============================================================================
// Anthropic Messages → Canonical
// Anthropic 格式跟 Canonical 几乎一样，主要是字段名 / 类型微调
// ============================================================================
import type { CanonicalRequest, CanonicalMessage, CanonicalContentBlock, CanonicalTool } from "../../canonical/types";

interface AnthropicRequest {
  model?: string;
  system?: string | Array<{ type: "text"; text: string; cache_control?: unknown }>;
  messages?: Array<{
    role: "user" | "assistant";
    content: string | Array<AnthropicContentBlock>;
  }>;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
  }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64" | "url"; media_type: string; data?: string; url?: string } }
  | { type: "document"; source: { type: "base64" | "url"; media_type: string; data?: string; url?: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string | Array<{ type: "text"; text: string }>; is_error?: boolean }
  | { type: "thinking"; thinking: string; signature?: string };

export function anthropicToCanonical(req: AnthropicRequest): CanonicalRequest {
  const messages: CanonicalMessage[] = (req.messages ?? []).map((m) => ({
    role: m.role,
    content: messageContentToBlocks(m.content),
  }));

  const tools: CanonicalTool[] | undefined = req.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
  }));

  // system 可以是字符串或 text block 数组
  let system: CanonicalRequest["system"];
  if (typeof req.system === "string") {
    system = req.system;
  } else if (Array.isArray(req.system)) {
    system = req.system.map((b) => ({ type: "text" as const, text: b.text }));
  }

  return {
    model: req.model ?? "",
    messages,
    system,
    tools: tools && tools.length > 0 ? tools : undefined,
    maxTokens: req.max_tokens,
    temperature: req.temperature,
    topP: req.top_p,
    stopSequences: req.stop_sequences,
    stream: !!req.stream,
  };
}

function messageContentToBlocks(content: string | AnthropicContentBlock[]): CanonicalContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.map((b): CanonicalContentBlock => {
    switch (b.type) {
      case "text":
        return { type: "text", text: b.text };
      case "image": {
        const src = b.source;
        if (src.type === "base64") {
          return { type: "image", source: { kind: "base64", mediaType: src.media_type, data: src.data ?? "" } };
        }
        return { type: "image", source: { kind: "url", mediaType: src.media_type, data: src.url ?? "" } };
      }
      case "document": {
        const src = b.source;
        if (src.type === "base64") {
          return { type: "document", source: { kind: "base64", mediaType: src.media_type, data: src.data ?? "" } };
        }
        return { type: "document", source: { kind: "url", mediaType: src.media_type, data: src.url ?? "" } };
      }
      case "tool_use":
        return { type: "tool_use", id: b.id, name: b.name, input: b.input };
      case "tool_result":
        return {
          type: "tool_result",
          toolUseId: b.tool_use_id,
          content: typeof b.content === "string" ? b.content : b.content.map((t) => ({ type: "text" as const, text: t.text })),
          isError: b.is_error,
        };
      case "thinking":
        return { type: "thinking", thinking: b.thinking, signature: b.signature };
    }
  });
}
