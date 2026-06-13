// ============================================================================
// OpenAI Chat Completions → Canonical
// ============================================================================
import type { CanonicalRequest, CanonicalMessage, CanonicalContentBlock, CanonicalTool, ProtocolExtras } from "../../canonical/types";
import { splitKnownAndExtras } from "../common/extras";

// OpenAI Chat Completions 的请求格式（我们只关心字段，不严格类型化）
type ChatContentPart = { type: string; text?: string; image_url?: { url: string }; [k: string]: unknown };
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
  [k: string]: unknown;
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
  [k: string]: unknown;
}

// 顶层已知字段集合 —— 顶层 extras 用，捕获 metadata / n / seed / response_format / parallel_tool_calls / stream_options 等
const KNOWN_TOP: ReadonlySet<string> = new Set([
  "model", "messages", "tools",
  "max_tokens", "temperature", "top_p", "stop", "stream",
]);

// per-role 已知字段集合 —— 每个 role 字面字段不同（如 tool 有 tool_call_id，user 没有）
// 注：name / function_call 等显式没在 canonical 处理的字段故意走 extras 桶 → outbound 时 spread 还原
const KNOWN_MSG_BY_ROLE: Record<string, ReadonlySet<string>> = {
  system: new Set(["role", "content"]),
  user: new Set(["role", "content"]),
  assistant: new Set(["role", "content", "tool_calls"]),
  tool: new Set(["role", "content", "tool_call_id"]),
};

// per-part 已知字段集合 —— text / image_url 各自的合法字段
const KNOWN_PART_BY_TYPE: Record<string, ReadonlySet<string>> = {
  text: new Set(["type", "text"]),
  image_url: new Set(["type", "image_url"]),
};

export function chatToCanonical(req: ChatRequest): CanonicalRequest {
  // 顶层 split：捕获 forward-compat 字段（metadata / n / seed / response_format 等）
  const { known, extras: topExtras } = splitKnownAndExtras(
    req as unknown as Record<string, unknown>,
    KNOWN_TOP,
    "openaiChat",
  );
  const r = known as ChatRequest;

  const messages: CanonicalMessage[] = [];
  let system: string | CanonicalContentBlock[] | undefined;

  for (const m of r.messages ?? []) {
    // system 单独提到顶级；§5.A: 多 system msg 折叠成 string 后，per-system-msg extras 不可达，直接丢
    // （Chat 协议硬限制：顶层 system 是 string 无元数据空间，fold 到顶层会污染 —— 比如 name 字段变 Chat 顶层 name）
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
    // §5.B：tool msg 级 extras 挂到 tool_result block 而不是 user message —— outbound 再 mergeExtras 还原回 tool message
    if (m.role === "tool") {
      const { extras } = splitKnownAndExtras(
        m as unknown as Record<string, unknown>,
        KNOWN_MSG_BY_ROLE.tool!,
        "openaiChat",
      );
      const blockExtras: ProtocolExtras | undefined = Object.keys(extras.openaiChat ?? {}).length > 0 ? extras : undefined;
      const block: CanonicalContentBlock = {
        type: "tool_result",
        toolUseId: m.tool_call_id ?? "",
        content: typeof m.content === "string" ? m.content : "",
        ...(blockExtras ? { extras: blockExtras } : {}),
      };
      messages.push({ role: "user", content: [block] });
      continue;
    }

    if (m.role === "user") {
      const blocks = contentToBlocks(m.content ?? null);
      const { extras } = splitKnownAndExtras(
        m as unknown as Record<string, unknown>,
        KNOWN_MSG_BY_ROLE.user!,
        "openaiChat",
      );
      messages.push({
        role: "user",
        content: blocks,
        ...(Object.keys(extras.openaiChat ?? {}).length > 0 ? { extras } : {}),
      });
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
      // assistant message 级 extras（name / 旧版 function_call / 任意未来字段）
      const { extras } = splitKnownAndExtras(
        m as unknown as Record<string, unknown>,
        KNOWN_MSG_BY_ROLE.assistant!,
        "openaiChat",
      );
      messages.push({
        role: "assistant",
        content: blocks,
        ...(Object.keys(extras.openaiChat ?? {}).length > 0 ? { extras } : {}),
      });
      continue;
    }
  }

  const tools: CanonicalTool[] | undefined = r.tools?.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    inputSchema: t.function.parameters ?? { type: "object", properties: {} },
  }));

  return {
    model: r.model ?? "",
    messages,
    system,
    tools: tools && tools.length > 0 ? tools : undefined,
    maxTokens: r.max_tokens,
    temperature: r.temperature,
    topP: r.top_p,
    stopSequences: Array.isArray(r.stop) ? r.stop : r.stop ? [r.stop] : undefined,
    stream: !!r.stream,
    ...(Object.keys(topExtras.openaiChat ?? {}).length > 0 ? { extras: topExtras } : {}),
  };
}

function contentToBlocks(content: string | null | ChatContentPart[]): CanonicalContentBlock[] {
  if (content == null) return [];
  if (typeof content === "string") return [{ type: "text", text: content }];
  const blocks: CanonicalContentBlock[] = [];
  for (const part of content) {
    // per-part split：image_url.detail / future part fields 落到 extras.openaiChat
    const { extras: partExtrasBag } = splitKnownAndExtras(
      part as unknown as Record<string, unknown>,
      KNOWN_PART_BY_TYPE[part.type] ?? new Set(["type"]),
      "openaiChat",
    );
    const partExtras: ProtocolExtras | undefined = Object.keys(partExtrasBag.openaiChat ?? {}).length > 0
      ? partExtrasBag
      : undefined;
    const attach = <T extends { type: string }>(built: T): T =>
      partExtras ? ({ ...built, extras: partExtras } as T) : built;

    if (part.type === "text" && part.text) {
      blocks.push(attach({ type: "text", text: part.text }));
    } else if (part.type === "image_url" && part.image_url) {
      const url = part.image_url.url;
      if (url.startsWith("data:")) {
        // data:image/png;base64,xxxx
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) blocks.push(attach({ type: "image", source: { kind: "base64", mediaType: match[1]!, data: match[2]! } }));
      } else {
        blocks.push(attach({ type: "image", source: { kind: "url", mediaType: "image/*", data: url } }));
      }
    } else {
      // 未知 part type（如 input_audio / input_file / 未来字段）：占位 text + extras 保留 payload
      blocks.push(attach({ type: "text", text: `[unknown_part:${part.type}]` }));
    }
  }
  return blocks;
}
