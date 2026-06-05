// ============================================================================
// Canonical 内部表示：与具体协议解耦的统一数据结构
// shape 接近 Anthropic Messages（因为它表达能力最丰富）
// ============================================================================

export type ApiFormat = "openai-chat" | "anthropic-messages";

export type StopReason = "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | "error";

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
}

export interface CanonicalMessage {
  role: "user" | "assistant";
  content: CanonicalContentBlock[];
}

export type CanonicalContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: ImageSource }
  | { type: "document"; source: DocumentSource }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string | CanonicalContentBlock[]; isError?: boolean }
  | { type: "thinking"; thinking: string; signature?: string };

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

export interface CanonicalResponse {
  id: string;
  model: string;
  content: CanonicalContentBlock[];
  stopReason: StopReason;
  usage: CanonicalUsage;
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
