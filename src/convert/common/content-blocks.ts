import type { CanonicalContentBlock } from "../../canonical/types";

// ============================================================================
// Content Block 工具函数
// ============================================================================

/** 把字符串或 block 数组统一成 block 数组（便于遍历） */
export function ensureBlocks(content: string | CanonicalContentBlock[]): CanonicalContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content;
}

/** 提取所有文本块（用于 Anthropic 风格的 system prompt 简化） */
export function extractText(blocks: CanonicalContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** 判断 block 是否是 tool_use */
export function isToolUse(b: CanonicalContentBlock): b is { type: "tool_use"; id: string; name: string; input: unknown } {
  return b.type === "tool_use";
}

/** 判断 block 是否是 tool_result */
export function isToolResult(b: CanonicalContentBlock): b is { type: "tool_result"; toolUseId: string; content: string | CanonicalContentBlock[]; isError?: boolean } {
  return b.type === "tool_result";
}
