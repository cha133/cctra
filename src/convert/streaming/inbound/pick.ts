// ============================================================================
// 按上游 apiFormat 选择 inbound stream parser
// 关键：必须用 ready.apiFormat（plugin 真实返回的），而不是 route.apiFormat（plugin 占位）
// ============================================================================
import type { ApiFormat } from "../../../types";
import type { CanonicalChunk } from "../../../canonical/types";
import { chatStreamToCanonical } from "./chat-stream";
import { anthropicStreamToCanonical } from "./anthropic-stream";
import { responsesStreamToCanonical } from "./responses-stream";

export type InboundStreamParser = (
  raw: ReadableStream<Uint8Array>,
) => AsyncGenerator<CanonicalChunk>;

export function pickInboundStreamParser(apiFormat: ApiFormat): InboundStreamParser {
  switch (apiFormat) {
    case "anthropic-messages": return anthropicStreamToCanonical;
    case "openai-responses":   return responsesStreamToCanonical;
    case "openai-chat":        return chatStreamToCanonical;
  }
}
