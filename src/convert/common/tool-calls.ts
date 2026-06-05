import type { CanonicalContentBlock } from "../../canonical/types";
import { isToolUse, isToolResult } from "./content-blocks";

// ============================================================================
// tool_use ↔ tool_calls 互转工具
// OpenAI Chat Completions 用 tool_calls / tool role messages
// OpenAI Responses / Anthropic 用结构化 content blocks
// ============================================================================

/** 提取消息里所有的 tool_use blocks */
export function extractToolUses(blocks: CanonicalContentBlock[]): Array<{ id: string; name: string; input: unknown }> {
  return blocks.filter(isToolUse).map((b) => ({ id: b.id, name: b.name, input: b.input }));
}

/** 提取消息里所有的 tool_result blocks */
export function extractToolResults(blocks: CanonicalContentBlock[]): Array<{ toolUseId: string; content: string; isError?: boolean }> {
  return blocks.filter(isToolResult).map((b) => ({
    toolUseId: b.toolUseId,
    content: typeof b.content === "string" ? b.content : extractTextFromBlocks(b.content),
    isError: b.isError,
  }));
}

function extractTextFromBlocks(blocks: CanonicalContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}
