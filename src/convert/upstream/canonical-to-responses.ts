// ============================================================================
// Canonical → OpenAI Responses 请求（发给上游用）
// ============================================================================
import type { CanonicalRequest, CanonicalContentBlock, ImageSource } from "../../canonical/types";
import { systemToString } from "../common/system-prompt";
import { mergeExtras } from "../common/extras";

// 每个变体加 `[k: string]: unknown` —— 允许 forward-compat 字段（function_call.status / message.id 等未来字段）在 wire 出现
// （mergeExtras 会注入；TS 需要知道这是合法的）
type ResponsesContentPart = { type: string; [k: string]: unknown };

type ResponsesInputItem =
  | { role: "user"; content: ResponsesContentPart[]; [k: string]: unknown }
  | { role: "assistant"; content: ResponsesContentPart[]; [k: string]: unknown }
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
    if (m.role === "assistant") {
      let content: ResponsesContentPart[] = [];
      const flushContent = () => {
        if (content.length === 0) return;
        input.push(mergeExtras({ role: "assistant" as const, content }, m.extras, "openaiResponses"));
        content = [];
      };

      for (const block of m.content) {
        if (block.type === "tool_use") {
          flushContent();
          input.push(mergeExtras({
            type: "function_call" as const,
            call_id: block.id,
            name: block.name,
            arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {}),
          }, block.extras, "openaiResponses"));
          continue;
        }
        const original = originalContentPart(block);
        if (original) content.push(original);
        else if (block.type === "text") content.push({ type: "output_text", text: block.text });
        else if (block.type === "refusal") content.push({ type: "refusal", refusal: block.refusal });
        // thinking / image / document / tool_result 不属于 Responses assistant message content
      }
      flushContent();
    } else {
      let content: ResponsesContentPart[] = [];
      const flushContent = () => {
        if (content.length === 0) return;
        input.push(mergeExtras({ role: "user" as const, content }, m.extras, "openaiResponses"));
        content = [];
      };

      for (const block of m.content) {
        if (block.type === "tool_result") {
          flushContent();
          input.push(mergeExtras({
            type: "function_call_output" as const,
            call_id: block.toolUseId,
            output: typeof block.content === "string" ? block.content : extractTextFromBlocks(block.content),
          }, block.extras, "openaiResponses"));
          continue;
        }
        const original = originalContentPart(block);
        if (original) content.push(original);
        else if (block.type === "text") content.push({ type: "input_text", text: block.text });
        else if (block.type === "image") content.push({ type: "input_image", image_url: imageToDataUrl(block.source) });
        // document / thinking / refusal 不属于 Responses user message content
      }
      flushContent();
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

function originalContentPart(block: CanonicalContentBlock): ResponsesContentPart | null {
  const original = block.extras?.openaiResponses?.originalContentPart;
  if (typeof original !== "object" || original === null || Array.isArray(original)) return null;
  if (typeof (original as { type?: unknown }).type !== "string") return null;
  return original as ResponsesContentPart;
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
