// ============================================================================
// Canonical → OpenAI Chat Completions 请求（发给上游用）
// ============================================================================
import type { CanonicalRequest, CanonicalContentBlock } from "../../canonical/types";
import { systemToString } from "../common/system-prompt";

interface ChatUpstreamRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_call_id?: string;
    tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  }>;
  tools?: Array<{ type: "function"; function: { name: string; description?: string; parameters?: Record<string, unknown> } }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream: boolean;
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
      } else {
        // 普通 user：text / image blocks 合并成字符串（v1 简化：丢图片只留文本）
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
      messages.push(msg);
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
  };
}

function extractText(blocks: CanonicalContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}
