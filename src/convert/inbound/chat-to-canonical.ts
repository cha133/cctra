// ============================================================================
// OpenAI Chat Completions → Canonical
// ============================================================================
import type { CanonicalRequest, CanonicalMessage, CanonicalContentBlock, CanonicalTool } from "../../canonical/types";

// OpenAI Chat Completions 的请求格式（我们只关心字段，不严格类型化）
type ChatContentPart = { type: string; text?: string; image_url?: { url: string } };
type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool" | "function";
  content?: string | null | ChatContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};
interface ChatRequest {
  model?: string;
  messages?: ChatMessage[];
  tools?: Array<{
    type: "function";
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
  }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  stream?: boolean;
}

export function chatToCanonical(req: ChatRequest): CanonicalRequest {
  const messages: CanonicalMessage[] = [];
  let system: string | CanonicalContentBlock[] | undefined;

  for (const m of req.messages ?? []) {
    // system 单独提到顶级
    if (m.role === "system") {
      const text = typeof m.content === "string" ? m.content : "";
      if (text) {
        if (typeof system === "string") system = system + "\n\n" + text;
        else if (Array.isArray(system)) system.push({ type: "text", text });
        else system = text;
      }
      continue;
    }

    // tool 消息 → tool_result block，挂到上一条 assistant 的回复里
    // 简化：把 tool 消息变成 user 消息的 tool_result
    if (m.role === "tool") {
      const blocks: CanonicalContentBlock[] = [
        {
          type: "tool_result",
          toolUseId: m.tool_call_id ?? "",
          content: typeof m.content === "string" ? m.content : "",
        },
      ];
      messages.push({ role: "user", content: blocks });
      continue;
    }

    if (m.role === "user") {
      const blocks = contentToBlocks(m.content ?? null);
      messages.push({ role: "user", content: blocks });
      continue;
    }

    if (m.role === "assistant") {
      const blocks: CanonicalContentBlock[] = [];
      if (m.content) blocks.push(...contentToBlocks(m.content));
      // tool_calls → tool_use blocks
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          let input: unknown = {};
          try { input = JSON.parse(tc.function.arguments); } catch { /* keep empty */ }
          blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
      }
      messages.push({ role: "assistant", content: blocks });
      continue;
    }
  }

  const tools: CanonicalTool[] | undefined = req.tools?.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: t.function.parameters ?? { type: "object", properties: {} },
  }));

  return {
    model: req.model ?? "",
    messages,
    system,
    tools: tools && tools.length > 0 ? tools : undefined,
    maxTokens: req.max_tokens,
    temperature: req.temperature,
    topP: req.top_p,
    stopSequences: Array.isArray(req.stop) ? req.stop : req.stop ? [req.stop] : undefined,
    stream: !!req.stream,
  };
}

function contentToBlocks(content: string | null | ChatContentPart[]): CanonicalContentBlock[] {
  if (content == null) return [];
  if (typeof content === "string") return [{ type: "text", text: content }];
  const blocks: CanonicalContentBlock[] = [];
  for (const part of content) {
    if (part.type === "text" && part.text) {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image_url" && part.image_url) {
      const url = part.image_url.url;
      if (url.startsWith("data:")) {
        // data:image/png;base64,xxxx
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) blocks.push({ type: "image", source: { kind: "base64", mediaType: match[1]!, data: match[2]! } });
      } else {
        blocks.push({ type: "image", source: { kind: "url", mediaType: "image/*", data: url } });
      }
    }
  }
  return blocks;
}
