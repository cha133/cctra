// ============================================================================
// OpenAI Responses API → Canonical
// 处理 input 字符串/数组、tools、stream、previous_response_id、reasoning
// 未知 input item type（如 web_search_call / mcp_call / file_search_call 等）走 forward-compat 兜底
// ============================================================================
import type { CanonicalRequest, CanonicalMessage, CanonicalContentBlock, CanonicalTool, ProtocolExtras } from "../../canonical/types";
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
  [k: string]: unknown;
}

// Responses input[] 的 3 种 item 形态（tagged union by `type`）
// - message 形态：带 role + content，content 里有 input_text / output_text / input_image / refusal
// - function_call 形态：flat item，承载 assistant 的工具调用
// - function_call_output 形态：flat item，承载 tool_result
// 每个变体加 `[k: string]: unknown`，让测试可以传 forward-compat 字段而 TS 不抱怨
type ResponsesInputMessage = {
  type: "message";
  role?: "user" | "assistant" | "system" | "developer";
  content: string | Array<{
    type: string;
    text?: string;
    image_url?: string;
    refusal?: string;
  }>;
  [k: string]: unknown;
};
type ResponsesInputFunctionCall = {
  type: "function_call";
  call_id?: string;
  id?: string;
  name?: string;
  arguments?: string;
  [k: string]: unknown;
};
type ResponsesInputFunctionCallOutput = {
  type: "function_call_output";
  call_id?: string;
  output?: string;
  [k: string]: unknown;
};
type ResponsesInputItem =
  | ResponsesInputMessage
  | ResponsesInputFunctionCall
  | ResponsesInputFunctionCallOutput;

// 顶层已知字段集合 —— 顶层 extras 用，捕获 background / include / metadata / store / text / tool_choice / prompt_cache_key 等
const KNOWN_TOP: ReadonlySet<string> = new Set([
  "model", "input", "instructions", "tools",
  "max_output_tokens", "temperature", "top_p", "stream",
  "previous_response_id", "reasoning",
]);

// per-input-item-type 已知字段集合
const KNOWN_INPUT_ITEM_BY_TYPE: Record<string, ReadonlySet<string>> = {
  message: new Set(["type", "role", "content"]),
  function_call: new Set(["type", "call_id", "id", "name", "arguments"]),
  function_call_output: new Set(["type", "call_id", "output"]),
};

export function responsesToCanonical(req: ResponsesRequest): CanonicalRequest {
  // 顶层 split：捕获 forward-compat 字段（background / include / metadata / store / text / tool_choice 等）
  const { known, extras: topExtras } = splitKnownAndExtras(
    req as unknown as Record<string, unknown>,
    KNOWN_TOP,
    "openaiResponses",
  );
  const r = known as ResponsesRequest;

  const messages: CanonicalMessage[] = [];

  if (typeof r.input === "string") {
    messages.push({ role: "user", content: [{ type: "text", text: r.input }] });
  } else if (Array.isArray(r.input)) {
    for (const m of r.input) {
      // function_call → assistant 消息带 tool_use block
      // call_id 优先（call-correlation ID），id fallback（item ID），跟 streaming/inbound/responses-stream.ts:239 一致
      // item 级 extras（如 status）挂到 tool_use block —— outbound 时 mergeExtras 还原回 function_call item
      if (m.type === "function_call") {
        const callId = m.call_id ?? m.id ?? "";
        let input: unknown = {};
        try { input = JSON.parse(m.arguments ?? "{}"); } catch { /* 保持空对象 */ }
        const { extras } = splitKnownAndExtras(
          m as unknown as Record<string, unknown>,
          KNOWN_INPUT_ITEM_BY_TYPE.function_call!,
          "openaiResponses",
        );
        const blockExtras: ProtocolExtras | undefined = Object.keys(extras.openaiResponses ?? {}).length > 0 ? extras : undefined;
        const block: CanonicalContentBlock = {
          type: "tool_use",
          id: callId,
          name: m.name ?? "",
          input,
          ...(blockExtras ? { extras: blockExtras } : {}),
        };
        messages.push({ role: "assistant", content: [block] });
        continue;
      }
      // function_call_output → user 消息带 tool_result block
      // item 级 extras 挂到 tool_result block
      if (m.type === "function_call_output") {
        const callId = m.call_id ?? "";
        const { extras } = splitKnownAndExtras(
          m as unknown as Record<string, unknown>,
          KNOWN_INPUT_ITEM_BY_TYPE.function_call_output!,
          "openaiResponses",
        );
        const blockExtras: ProtocolExtras | undefined = Object.keys(extras.openaiResponses ?? {}).length > 0 ? extras : undefined;
        const block: CanonicalContentBlock = {
          type: "tool_result",
          toolUseId: callId,
          content: m.output ?? "",
          ...(blockExtras ? { extras: blockExtras } : {}),
        };
        messages.push({ role: "user", content: [block] });
        continue;
      }
      // 未知 type（如 web_search_call / mcp_call / file_search_call 等）：占位 text + extras 存原始 payload（forward-compat 兜底）
      // §5.D 决策：替换原 0.5.1 的「静默跳」行为（信息丢失），改为保留原始 payload
      // 用 cast 临时变量避开 discriminator narrow（联合穷举后 m 在此处会被 narrow 成 never）
      if (m.type !== undefined && m.type !== "message") {
        const unknownType = (m as unknown as { type: string }).type;
        messages.push({
          role: "user",
          content: [{
            type: "text",
            text: `[unknown_input_item:${unknownType}]`,
            extras: { openaiResponses: { originalPayload: m as unknown as Record<string, unknown> } },
          }],
        });
        continue;
      }

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
      // message item 级 extras（type / role / content 之外的所有字段）
      const { extras } = splitKnownAndExtras(
        m as unknown as Record<string, unknown>,
        KNOWN_INPUT_ITEM_BY_TYPE.message!,
        "openaiResponses",
      );
      messages.push({
        role,
        content: blocks,
        ...(Object.keys(extras.openaiResponses ?? {}).length > 0 ? { extras } : {}),
      });
    }
  }

  const tools: CanonicalTool[] | undefined = r.tools
    ?.filter((t) => t.type === "function")
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters ?? { type: "object", properties: {} },
    }));

  return {
    model: r.model ?? "",
    messages,
    system: r.instructions,
    tools: tools && tools.length > 0 ? tools : undefined,
    maxTokens: r.max_output_tokens,
    temperature: r.temperature,
    topP: r.top_p,
    stream: !!r.stream,
    previousResponseId: r.previous_response_id,
    reasoning: r.reasoning,
    ...(Object.keys(topExtras.openaiResponses ?? {}).length > 0 ? { extras: topExtras } : {}),
  };
}
