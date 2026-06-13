// ============================================================================
// Anthropic Messages → Canonical
// Anthropic 格式跟 Canonical 几乎一样，主要是字段名 / 类型微调
// ============================================================================
import type { CanonicalRequest, CanonicalMessage, CanonicalContentBlock, CanonicalTool, ProtocolExtras } from "../../canonical/types";
import { splitKnownAndExtras } from "../common/extras";

interface AnthropicRequest {
  model?: string;
  system?: string | Array<{ type: "text"; text: string; cache_control?: unknown }>;
  messages?: Array<{
    role: "user" | "assistant";
    content: string | Array<AnthropicContentBlock>;
  }>;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
  }>;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64" | "url"; media_type: string; data?: string; url?: string } }
  | { type: "document"; source: { type: "base64" | "url"; media_type: string; data?: string; url?: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string | Array<{ type: "text"; text: string }>; is_error?: boolean }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "redacted_thinking"; data: string };

// 顶层已知字段集合 —— 顶层 extras 用，捕获 metadata / context_management / mcp_servers 等 forward-compat
const KNOWN_TOP: ReadonlySet<string> = new Set([
  "model", "system", "messages", "tools",
  "max_tokens", "temperature", "top_p", "stop_sequences", "stream",
]);

// block 级已知字段集合 —— per-type，避免在每个 case 重复写 set 字面量
// redacted_thinking: 只把 type 算 known，data 故意走 extras（保证 round-trip 时上游能透传）
const KNOWN_BLOCK_BY_TYPE: Record<string, ReadonlySet<string>> = {
  text: new Set(["type", "text"]),
  image: new Set(["type", "source"]),
  document: new Set(["type", "source"]),
  tool_use: new Set(["type", "id", "name", "input"]),
  tool_result: new Set(["type", "tool_use_id", "content", "is_error"]),
  thinking: new Set(["type", "thinking", "signature"]),
  redacted_thinking: new Set(["type"]),
};

export function anthropicToCanonical(req: AnthropicRequest): CanonicalRequest {
  // 顶层 split：捕获未来字段（metadata / context_management / mcp_servers 等）
  const { known, extras: topExtras } = splitKnownAndExtras(
    req as unknown as Record<string, unknown>,
    KNOWN_TOP,
    "anthropic",
  );
  const r = known as AnthropicRequest;

  const messages: CanonicalMessage[] = (r.messages ?? []).map((m) => {
    const knownMsgKeys: ReadonlySet<keyof typeof m> = new Set(["role", "content"]);
    const { known: knownMsg, extras } = splitKnownAndExtras(m as unknown as Record<string, unknown>, knownMsgKeys as ReadonlySet<keyof Record<string, unknown>>, "anthropic");
    return {
      ...(knownMsg as { role: "user" | "assistant" }),
      content: messageContentToBlocks(m.content),
      ...(Object.keys(extras).length > 0 ? { extras } : {}),
    };
  });

  const tools: CanonicalTool[] | undefined = r.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.input_schema,
  }));

  // system 可以是字符串或 text block 数组
  // 数组分支保留 cache_control（prompt caching 关键字段），落到对应 block 的 extras.anthropic
  let system: CanonicalRequest["system"];
  if (typeof r.system === "string") {
    system = r.system;
  } else if (Array.isArray(r.system)) {
    system = r.system.map((b) => {
      const block: { type: "text"; text: string; extras?: ProtocolExtras } = {
        type: "text" as const,
        text: b.text,
      };
      if (b.cache_control !== undefined) {
        block.extras = { anthropic: { cache_control: b.cache_control } };
      }
      return block;
    });
  }

  return {
    model: r.model ?? "",
    messages,
    system,
    tools: tools && tools.length > 0 ? tools : undefined,
    maxTokens: r.max_tokens,
    temperature: r.temperature,
    topP: r.top_p,
    stopSequences: r.stop_sequences,
    stream: !!r.stream,
    ...(Object.keys(topExtras.anthropic ?? {}).length > 0 ? { extras: topExtras } : {}),
  };
}

function messageContentToBlocks(content: string | AnthropicContentBlock[]): CanonicalContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.map((rawB): CanonicalContentBlock => {
    // per-block split：cache_control 等未知字段落到 extras.anthropic，round-trip 时由 outbound 的 mergeExtras 复原
    const { known, extras: blockExtrasBag } = splitKnownAndExtras(
      rawB as unknown as Record<string, unknown>,
      KNOWN_BLOCK_BY_TYPE[rawB.type] ?? new Set(["type"]),
      "anthropic",
    );
    // known 里的 type 字段 + 已被识别为某种已知变体 → cast；未知 type 走 default 分支
    const b = known as AnthropicContentBlock | { type: string };
    const blockExtras: ProtocolExtras | undefined = Object.keys(blockExtrasBag.anthropic ?? {}).length > 0
      ? blockExtrasBag
      : undefined;
    const attach = <T extends { type: string }>(built: T): T =>
      blockExtras ? ({ ...built, extras: blockExtras } as T) : built;

    switch (b.type) {
      case "text":
        return attach({ type: "text", text: (b as { text: string }).text });
      case "image": {
        const src = (b as Extract<AnthropicContentBlock, { type: "image" }>).source;
        if (src.type === "base64") {
          return attach({ type: "image", source: { kind: "base64", mediaType: src.media_type, data: src.data ?? "" } });
        }
        return attach({ type: "image", source: { kind: "url", mediaType: src.media_type, data: src.url ?? "" } });
      }
      case "document": {
        const src = (b as Extract<AnthropicContentBlock, { type: "document" }>).source;
        if (src.type === "base64") {
          return attach({ type: "document", source: { kind: "base64", mediaType: src.media_type, data: src.data ?? "" } });
        }
        return attach({ type: "document", source: { kind: "url", mediaType: src.media_type, data: src.url ?? "" } });
      }
      case "tool_use": {
        const tb = b as Extract<AnthropicContentBlock, { type: "tool_use" }>;
        return attach({ type: "tool_use", id: tb.id, name: tb.name, input: tb.input });
      }
      case "tool_result": {
        const tb = b as Extract<AnthropicContentBlock, { type: "tool_result" }>;
        return attach({
          type: "tool_result",
          toolUseId: tb.tool_use_id,
          content: typeof tb.content === "string" ? tb.content : tb.content.map((t: { type: "text"; text: string }) => ({ type: "text" as const, text: t.text })),
          isError: tb.is_error,
        });
      }
      case "thinking": {
        const tb = b as Extract<AnthropicContentBlock, { type: "thinking" }>;
        return attach({ type: "thinking", thinking: tb.thinking, signature: tb.signature });
      }
      case "redacted_thinking":
        // 降级为占位 text + extras 保留 data；不引入新 canonical 变体（避免 canonical 被 anthropic 牵着走）
        return attach({ type: "text", text: "[redacted_thinking]" });
      default: {
        // 未知 block type：占位 text + extras 存原始 payload（forward-compat 兜底）
        return attach({ type: "text", text: `[unknown_block:${b.type}]` });
      }
    }
  });
}
