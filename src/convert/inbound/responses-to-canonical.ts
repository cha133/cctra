// ============================================================================
// OpenAI Responses API → Canonical
// 处理 input 字符串/数组、tools、stream、previous_response_id、reasoning
// 跳过：5 个内置工具（web_search/code_interpreter/file_search/mcp/computer_use）
// ============================================================================
import type { CanonicalRequest, CanonicalMessage, CanonicalContentBlock, CanonicalTool } from "../../canonical/types";
import { splitKnownAndExtras } from "../common/extras";

interface ResponsesRequest {
  model?: string;
  input?: string | ResponsesInputItem[];
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

// Responses input[] 的 3 种 item 形态（tagged union by `type`）
// - message 形态：带 role + content，content 里有 input_text / output_text / input_image / refusal
// - function_call 形态：flat item，承载 assistant 的工具调用
// - function_call_output 形态：flat item，承载 tool_result
type ResponsesInputMessage = {
  type: "message";
  role?: "user" | "assistant" | "system" | "developer";
  content: string | Array<{
    type: string;
    text?: string;
    image_url?: string;
    refusal?: string;
  }>;
};
type ResponsesInputFunctionCall = {
  type: "function_call";
  call_id?: string;
  id?: string;
  name?: string;
  arguments?: string;
};
type ResponsesInputFunctionCallOutput = {
  type: "function_call_output";
  call_id?: string;
  output?: string;
};
type ResponsesInputItem =
  | ResponsesInputMessage
  | ResponsesInputFunctionCall
  | ResponsesInputFunctionCallOutput;

export function responsesToCanonical(req: ResponsesRequest): CanonicalRequest {
  const messages: CanonicalMessage[] = [];

  if (typeof req.input === "string") {
    messages.push({ role: "user", content: [{ type: "text", text: req.input }] });
  } else if (Array.isArray(req.input)) {
    for (const m of req.input) {
      // function_call → assistant 消息带 tool_use block
      // call_id 优先（call-correlation ID），id fallback（item ID），跟 streaming/inbound/responses-stream.ts:239 一致
      if (m.type === "function_call") {
        const callId = m.call_id ?? m.id ?? "";
        let input: unknown = {};
        try { input = JSON.parse(m.arguments ?? "{}"); } catch { /* 保持空对象 */ }
        messages.push({
          role: "assistant",
          content: [{ type: "tool_use", id: callId, name: m.name ?? "", input }],
        });
        continue;
      }
      // function_call_output → user 消息带 tool_result block
      if (m.type === "function_call_output") {
        const callId = m.call_id ?? "";
        messages.push({
          role: "user",
          content: [{ type: "tool_result", toolUseId: callId, content: m.output ?? "" }],
        });
        continue;
      }
      // 未知 type（如 web_search_call / mcp_call / file_search_call 等）静默跳
      if (m.type !== undefined && m.type !== "message") continue;

      // message 形态
      const role = m.role === "assistant" ? "assistant" : "user";
      const blocks: CanonicalContentBlock[] = [];
      if (typeof m.content === "string") {
        blocks.push({ type: "text", text: m.content });
      } else {
        for (const part of m.content) {
          if ((part.type === "input_text" || part.type === "output_text") && part.text) {
            blocks.push({ type: "text", text: part.text });
          } else if (part.type === "refusal" && part.refusal) {
            blocks.push({ type: "refusal", refusal: part.refusal });
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
      // extras：未识别字段塞 openaiResponses 桶（type 也算已知，避免被误塞）
      const knownMsgKeys = new Set(["role", "content", "type"]);
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
