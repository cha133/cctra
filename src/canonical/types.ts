// ============================================================================
// Canonical 内部表示：与具体协议解耦的统一数据结构
// shape 接近 Anthropic Messages（因为它表达能力最丰富）
// ============================================================================

export type ApiFormat = "openai-chat" | "openai-responses" | "anthropic-messages";

export type StopReason = "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "error";

// ---------- Per-protocol extras（透传未识别字段） ----------

/**
 * 按协议分类的「未识别字段」桶。
 * - inbound 时把协议原请求中未识别的字段塞进对应协议桶
 * - outbound 时按目标协议把对应桶 spread 进结果对象
 * 例：anthropic → canonical → anthropic 链路里 cache_control 字段不会丢失
 */
export interface ProtocolExtras {
  anthropic?: Record<string, unknown>;
  openaiChat?: Record<string, unknown>;
  openaiResponses?: Record<string, unknown>;
}

// ---------- Request ----------

export interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  system?: string | CanonicalContentBlock[];
  tools?: CanonicalTool[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  stream: boolean;
  metadata?: Record<string, unknown>;
  // OpenAI Responses 多轮链路 ID（cctra 仅做透传，不维护链路状态）
  previousResponseId?: string;
  // 思考强度（OpenAI Responses `reasoning.effort` / Anthropic `thinking.budget_tokens` 的统一抽象）
  reasoning?: { effort?: "low" | "medium" | "high" };
  // 透传未识别字段（按协议分类）
  extras?: ProtocolExtras;
}

export interface CanonicalMessage {
  role: "user" | "assistant";
  content: CanonicalContentBlock[];
  extras?: ProtocolExtras;
}

export type CanonicalContentBlock = (
  | { type: "text"; text: string }
  | { type: "image"; source: ImageSource }
  | { type: "document"; source: DocumentSource }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string | CanonicalContentBlock[]; isError?: boolean }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "refusal"; refusal: string }
) & { extras?: ProtocolExtras };

export interface ImageSource {
  kind: "url" | "base64";
  mediaType: string;            // e.g. "image/png"
  data: string;                 // URL string or base64-encoded data
}

export interface DocumentSource {
  kind: "url" | "base64";
  mediaType: string;
  data: string;
}

export interface CanonicalTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

// ---------- Response ----------

/**
 * 错误响应的结构化字段。
 * - `message`：人类可读错误消息
 * - `status`：上游 HTTP status code（4xx/5xx 透传用；plugin/network/parse 错无此字段）
 * - `type`：错误分类标签
 */
export interface CanonicalResponseError {
  message: string;
  status?: number;
  type?: "upstream_error" | "network_error" | "plugin_error" | "parse_error";
}

export interface CanonicalResponse {
  id: string;
  model: string;
  content: CanonicalContentBlock[];
  stopReason: StopReason;
  usage: CanonicalUsage;
  /** 错误响应的结构化字段（替代过去用 `content[0].text` + `stopReason: "error"` 表达错误） */
  error?: CanonicalResponseError;
}

export interface CanonicalUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

// ---------- Streaming Chunks ----------
// 字段跟 Anthropic SSE 几乎一致，方便直接复用 streaming 状态机

export type CanonicalChunk =
  | { type: "message_start"; message: CanonicalResponse }
  | { type: "content_block_start"; index: number; content_block: CanonicalContentBlock }
  | { type: "content_block_delta"; index: number; delta: ContentBlockDelta }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: MessageDelta; usage?: Partial<CanonicalUsage> }
  | { type: "message_stop" }
  | { type: "ping" }
  | { type: "error"; error: string };

export type ContentBlockDelta =
  | { type: "text_delta"; text: string }
  | { type: "input_json_delta"; partial_json: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "signature_delta"; signature: string };

export interface MessageDelta {
  stop_reason?: StopReason;
  stop_sequence?: string;
}
