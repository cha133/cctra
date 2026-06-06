// ============================================================================
// Canonical → OpenAI Chat Completions 请求（发给上游用）
// ============================================================================
import type { CanonicalRequest, CanonicalContentBlock, ImageSource } from "../../canonical/types";
import { systemToString } from "../common/system-prompt";
import { mergeExtras } from "../common/extras";

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatUpstreamRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null | ChatContentPart[];
    tool_call_id?: string;
    tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  }>;
  tools?: Array<{ type: "function"; function: { name: string; description?: string; parameters?: Record<string, unknown> } }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream: boolean;
  // 兼容 reasoning_effort（OpenAI o-series / 兼容上游可识别）
  reasoning_effort?: "low" | "medium" | "high";
}

export function canonicalToChatUpstream(req: CanonicalRequest): ChatUpstreamRequest {
  const messages: ChatUpstreamRequest["messages"] = [];

  // 顶级 system → 第一条 system message
  const sysText = systemToString(req.system);
  if (sysText) messages.push({ role: "system", content: sysText });

  for (const m of req.messages) {
    if (m.role === "user") {
      const userBlocks = m.content;
      // 检查是否全是 tool_result
      const toolResults = userBlocks.filter((b) => b.type === "tool_result");
      if (toolResults.length > 0 && toolResults.length === userBlocks.length) {
        for (const tr of toolResults) {
          if (tr.type === "tool_result") {
            messages.push({
              role: "tool",
              content: typeof tr.content === "string" ? tr.content : "",
              tool_call_id: tr.toolUseId,
            });
          }
        }
      } else if (userBlocks.some((b) => b.type === "image")) {
        // 多模态：构造 OpenAI Chat content parts 数组
        const parts: ChatContentPart[] = [];
        for (const b of userBlocks) {
          if (b.type === "text") {
            parts.push({ type: "text", text: b.text });
          } else if (b.type === "image") {
            parts.push({ type: "image_url", image_url: { url: imageToDataUrl(b.source) } });
          }
          // document → OpenAI 兼容端点一般不支持，丢
        }
        messages.push({ role: "user", content: parts });
      } else {
        // 纯文本：合并成字符串
        const text = extractText(userBlocks);
        messages.push({ role: "user", content: text });
      }
    } else if (m.role === "assistant") {
      const text = extractText(m.content);
      const toolUses = m.content.filter((b): b is { type: "tool_use"; id: string; name: string; input: unknown } => b.type === "tool_use");
      const msg: ChatUpstreamRequest["messages"][number] = { role: "assistant", content: text || null };
      if (toolUses.length > 0) {
        msg.tool_calls = toolUses.map((u) => ({
          id: u.id,
          type: "function",
          function: {
            name: u.name,
            arguments: typeof u.input === "string" ? u.input : JSON.stringify(u.input ?? {}),
          },
        }));
      }
      // 透传 assistant message 级别 extras（openaiChat 桶）
      const merged = mergeExtras(msg as unknown as Record<string, unknown>, m.extras, "openaiChat");
      messages.push(merged as unknown as ChatUpstreamRequest["messages"][number]);
    }
  }

  return {
    model: req.model,
    messages,
    tools: req.tools?.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    })),
    max_tokens: req.maxTokens,
    temperature: req.temperature,
    top_p: req.topP,
    stop: req.stopSequences,
    stream: req.stream,
    reasoning_effort: req.reasoning?.effort,
  };
}

function imageToDataUrl(src: ImageSource): string {
  if (src.kind === "base64") return `data:${src.mediaType};base64,${src.data}`;
  return src.data;
}

function extractText(blocks: CanonicalContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}
