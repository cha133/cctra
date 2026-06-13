// ============================================================================
// Canonical → OpenAI Responses 请求（发给上游用）
// ============================================================================
import type { CanonicalRequest, CanonicalContentBlock, ImageSource, ProtocolExtras } from "../../canonical/types";
import { systemToString } from "../common/system-prompt";
import { mergeExtras } from "../common/extras";

// 每个变体加 `[k: string]: unknown` —— 允许 forward-compat 字段（function_call.status / message.id 等未来字段）在 wire 出现
// （mergeExtras 会注入；TS 需要知道这是合法的）
type ResponsesInputItem =
  | { role: "user"; content: Array<{ type: "input_text"; text: string; [k: string]: unknown } | { type: "input_image"; image_url: string; [k: string]: unknown }>; [k: string]: unknown }
  | { role: "assistant"; content: Array<{ type: "output_text"; text: string; [k: string]: unknown } | { type: "refusal"; refusal: string; [k: string]: unknown }>; [k: string]: unknown }
  | { type: "function_call"; call_id: string; name: string; arguments: string; [k: string]: unknown }
  | { type: "function_call_output"; call_id: string; output: string; [k: string]: unknown };

interface ResponsesTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  [k: string]: unknown;
}

interface ResponsesUpstreamRequest {
  model: string;
  input: ResponsesInputItem[];
  instructions?: string;
  tools?: ResponsesTool[];
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream: boolean;
  reasoning?: { effort: "low" | "medium" | "high" };
  previous_response_id?: string;
  // forward-compat: 顶层 extras.openaiResponses（background / include / metadata / store / text / tool_choice / prompt_cache_key 等）一并 spread
  [k: string]: unknown;
}

export function canonicalToResponses(req: CanonicalRequest): ResponsesUpstreamRequest {
  const input: ResponsesInputItem[] = [];
  const instructions = systemToString(req.system);

  for (const m of req.messages) {
    // 抽 assistant tool_use 块 → 平级 function_call item（不是 message）
    if (m.role === "assistant") {
      const toolUses = m.content.filter((b): b is { type: "tool_use"; id: string; name: string; input: unknown; extras?: ProtocolExtras } => b.type === "tool_use");
      const otherBlocks = m.content.filter((b) => b.type !== "tool_use");

      // assistant message（含 text / refusal）
      if (otherBlocks.length > 0) {
        const content: Array<{ type: "output_text"; text: string } | { type: "refusal"; refusal: string }> = [];
        for (const b of otherBlocks) {
          if (b.type === "text") content.push({ type: "output_text", text: b.text });
          else if (b.type === "refusal") content.push({ type: "refusal", refusal: b.refusal });
          // 忽略 thinking / image / document / tool_result 在 assistant message
        }
        if (content.length > 0) {
          // 透传 assistant message 级别 extras（openaiResponses 桶）
          input.push(mergeExtras({ role: "assistant" as const, content }, m.extras, "openaiResponses"));
        }
      }

      // function_call item（每个 tool_use 一个）；block 级 extras（如 status）从 tool_use block 透传
      for (const u of toolUses) {
        input.push(mergeExtras({
          type: "function_call" as const,
          call_id: u.id,
          name: u.name,
          arguments: typeof u.input === "string" ? u.input : JSON.stringify(u.input ?? {}),
        }, u.extras, "openaiResponses"));
      }
    } else {
      // user 消息
      const toolResults = m.content.filter((b): b is { type: "tool_result"; toolUseId: string; content: string | CanonicalContentBlock[]; isError?: boolean; extras?: ProtocolExtras } => b.type === "tool_result");
      const otherBlocks = m.content.filter((b) => b.type !== "tool_result");

      // function_call_output item（每个 tool_result 一个）；block 级 extras 从 tool_result block 透传
      for (const tr of toolResults) {
        input.push(mergeExtras({
          type: "function_call_output" as const,
          call_id: tr.toolUseId,
          output: typeof tr.content === "string" ? tr.content : extractTextFromBlocks(tr.content),
        }, tr.extras, "openaiResponses"));
      }

      // user message（含 text / image）
      if (otherBlocks.length > 0) {
        const content: Array<{ type: "input_text"; text: string } | { type: "input_image"; image_url: string }> = [];
        for (const b of otherBlocks) {
          if (b.type === "text") content.push({ type: "input_text", text: b.text });
          else if (b.type === "image") content.push({ type: "input_image", image_url: imageToDataUrl(b.source) });
          // 忽略 document / thinking / refusal 在 user message
        }
        if (content.length > 0) {
          // 透传 user message 级别 extras
          input.push(mergeExtras({ role: "user" as const, content }, m.extras, "openaiResponses"));
        }
      }
    }
  }

  return {
    model: req.model,
    input,
    ...(instructions ? { instructions } : {}),
    tools: req.tools?.map((t) => ({
      type: "function" as const,
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    })),
    max_output_tokens: req.maxTokens,
    temperature: req.temperature,
    top_p: req.topP,
    stream: req.stream,
    ...(req.reasoning?.effort ? { reasoning: { effort: req.reasoning.effort } } : {}),
    ...(req.previousResponseId ? { previous_response_id: req.previousResponseId } : {}),
    // 顶层 extras spread（background / include / metadata / store / text / tool_choice 等）
    ...(req.extras?.openaiResponses ?? {}),
  };
}

function imageToDataUrl(src: ImageSource): string {
  if (src.kind === "base64") return `data:${src.mediaType};base64,${src.data}`;
  return src.data;
}

function extractTextFromBlocks(blocks: CanonicalContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}
