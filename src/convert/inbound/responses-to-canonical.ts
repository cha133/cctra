// ============================================================================
// OpenAI Responses API → Canonical
// 处理 input 字符串/数组、tools、stream、previous_response_id、reasoning
// 跳过：5 个内置工具（web_search/code_interpreter/file_search/mcp/computer_use）
// ============================================================================
import type { CanonicalRequest, CanonicalMessage, CanonicalContentBlock, CanonicalTool } from "../../canonical/types";
import { splitKnownAndExtras } from "../common/extras";

interface ResponsesRequest {
  model?: string;
  input?: string | Array<{
    role?: "user" | "assistant" | "system" | "developer";
    content: string | Array<{
      type: string;
      text?: string;
      image_url?: string;
    }>;
  }>;
  instructions?: string;
  tools?: Array<{
    type: "function";
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  previous_response_id?: string;
  reasoning?: { effort?: "low" | "medium" | "high" };
}

export function responsesToCanonical(req: ResponsesRequest): CanonicalRequest {
  const messages: CanonicalMessage[] = [];

  if (typeof req.input === "string") {
    messages.push({ role: "user", content: [{ type: "text", text: req.input }] });
  } else if (Array.isArray(req.input)) {
    for (const m of req.input) {
      const role = m.role === "assistant" ? "assistant" : "user";
      const blocks: CanonicalContentBlock[] = [];
      if (typeof m.content === "string") {
        blocks.push({ type: "text", text: m.content });
      } else {
        for (const part of m.content) {
          if (part.type === "input_text" && part.text) {
            blocks.push({ type: "text", text: part.text });
          } else if (part.type === "input_image" && part.image_url) {
            const url = part.image_url;
            if (url.startsWith("data:")) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) blocks.push({ type: "image", source: { kind: "base64", mediaType: match[1]!, data: match[2]! } });
            } else {
              blocks.push({ type: "image", source: { kind: "url", mediaType: "image/*", data: url } });
            }
          }
        }
      }
      // extras：未识别字段塞 openaiResponses 桶
      const knownMsgKeys = new Set(["role", "content"]);
      const { known: _k, extras } = splitKnownAndExtras(m as unknown as Record<string, unknown>, knownMsgKeys, "openaiResponses");
      void _k;
      messages.push({
        role,
        content: blocks,
        ...(Object.keys(extras).length > 0 ? { extras } : {}),
      });
    }
  }

  const tools: CanonicalTool[] | undefined = req.tools
    ?.filter((t) => t.type === "function")
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters ?? { type: "object", properties: {} },
    }));

  return {
    model: req.model ?? "",
    messages,
    system: req.instructions,
    tools: tools && tools.length > 0 ? tools : undefined,
    maxTokens: req.max_output_tokens,
    temperature: req.temperature,
    topP: req.top_p,
    stream: !!req.stream,
    previousResponseId: req.previous_response_id,
    reasoning: req.reasoning,
  };
}
