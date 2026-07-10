// ============================================================================
// Canonical → OpenAI Chat Completions 请求（发给上游用）
// ============================================================================
import type { CanonicalRequest, CanonicalContentBlock, ImageSource } from "../../canonical/types";
import { systemToString } from "../common/system-prompt";
import { mergeExtras } from "../common/extras";

// 每个变体加 `[k: string]: unknown` —— 允许 forward-compat 字段（如 OpenAI image_url.detail / 未来 part 字段）在 wire 出现
// （mergeExtras 会注入；TS 需要知道这是合法的）
type ChatContentPart =
  | { type: "text"; text: string; [k: string]: unknown }
  | { type: "image_url"; image_url: { url: string; [k: string]: unknown }; [k: string]: unknown };

interface ChatUpstreamRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string | null | ChatContentPart[];
    tool_call_id?: string;
    tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string }; [k: string]: unknown }>;
    [k: string]: unknown;
  }>;
  tools?: Array<{ type: "function"; function: { name: string; description?: string; parameters?: Record<string, unknown> } }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream: boolean;
  // 兼容 reasoning_effort（OpenAI o-series / 兼容上游可识别）
  reasoning_effort?: "low" | "medium" | "high";
  // forward-compat: 顶层 extras.openaiChat（metadata / n / seed / response_format / parallel_tool_calls / stream_options 等）一并 spread
  [k: string]: unknown;
}

export function canonicalToChatUpstream(req: CanonicalRequest): ChatUpstreamRequest {
  const messages: ChatUpstreamRequest["messages"] = [];

  // 顶级 system → 第一条 system message
  const sysText = systemToString(req.system);
  if (sysText) messages.push({ role: "system", content: sysText });

  for (const m of req.messages) {
    if (m.role === "user") {
      // 遍历 user 消息的所有 block：
      //   - tool_result 立即 push 成 role:"tool" 消息（保证紧跟在前一条 assistant tool_calls 之后）
      //   - text 累积成单一字符串，image 进 contentParts
      // 循环结束后再 push 累积的 user 消息
      // → output 顺序是 [...tool_msgs, user_msg]，符合 OpenAI Chat 协议
      // 修前 bug：mixed text+tool_result 时旧三分支的"纯文本"else 会吞掉 tool_result
      let textAccum = "";
      const contentParts: ChatContentPart[] = [];
      const toolMessages: ChatUpstreamRequest["messages"] = [];
      for (const b of m.content) {
        if (b.type === "tool_result") {
          // 顺带修一个 latent bug：array-form content 之前会被压成 ""，现在扁平化为 text
          const text = typeof b.content === "string" ? b.content : extractText(b.content);
          const content = b.isError ? `[error] ${text}` : text;
          // §5.B：tool_result block.extras 路由到 synthesized tool message（inbound 把 tool msg 级 extras 挂到这个 block）
          toolMessages.push(mergeExtras({
            role: "tool" as const,
            content,
            tool_call_id: b.toolUseId,
          }, b.extras, "openaiChat"));
        } else if (b.type === "text" && b.text) {
          textAccum += b.text;
        } else if (b.type === "image") {
          // image part 级 extras（如 detail: "high"）透传
          contentParts.push(mergeExtras({ type: "image_url" as const, image_url: { url: imageToDataUrl(b.source) } }, b.extras, "openaiChat"));
        }
        // document / thinking / refusal / tool_use 不应出现在 user 消息里，忽略
      }
      messages.push(...toolMessages);
      // 拼回累积的 text 和 image：纯文本时合成 string（更紧凑），有 image 时用 content parts 数组
      if (textAccum || contentParts.length > 0) {
        if (contentParts.length === 0) {
          // 透传 user message 级别 extras（openaiChat 桶）—— 如 name 字段
          messages.push(mergeExtras({ role: "user" as const, content: textAccum }, m.extras, "openaiChat"));
        } else {
          const parts: ChatContentPart[] = [];
          if (textAccum) parts.push({ type: "text", text: textAccum });
          parts.push(...contentParts);
          messages.push(mergeExtras({ role: "user" as const, content: parts }, m.extras, "openaiChat"));
        }
      }
    } else if (m.role === "assistant") {
      const text = extractText(m.content);
      const toolUses = m.content.filter((b): b is { type: "tool_use"; id: string; name: string; input: unknown; extras?: import("../../canonical/types").ProtocolExtras } => b.type === "tool_use");
      const msg: ChatUpstreamRequest["messages"][number] = { role: "assistant", content: text || null };
      if (toolUses.length > 0) {
        msg.tool_calls = toolUses.map((u) => mergeExtras({
          id: u.id,
          type: "function" as const,
          function: {
            name: u.name,
            arguments: typeof u.input === "string" ? u.input : JSON.stringify(u.input ?? {}),
          },
        }, u.extras, "openaiChat"));
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
    // OpenAI Chat 流式中返回 usage 的开关。上游不支持时静默忽略。
    stream_options: { include_usage: true },
    reasoning_effort: req.reasoning?.effort,
    // 合并两个 extras 桶：openaiResponses 中 Chat 能理解的字段（metadata / tool_choice / parallel_tool_calls 等）也透传给上游
    // openaiChat 桶优先级更高（避免冲突时 Chat 特有字段被覆盖）
    ...(() => {
      const mergedExtras = { ...(req.extras?.openaiResponses ?? {}), ...(req.extras?.openaiChat ?? {}) };
      return Object.keys(mergedExtras).length > 0 ? mergedExtras : {};
    })(),
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
