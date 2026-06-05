import type { CanonicalContentBlock } from "../../canonical/types";

// 处理 reasoning/thinking 块的辅助
// Anthropic 的 thinking block 有 signature，cc-switch 的 thinking_rectifier 模式下
// 我们只在 signature 存在时回传，避免浪费 token

export function stripThinkingContent(blocks: CanonicalContentBlock[]): CanonicalContentBlock[] {
  return blocks.map((b) => {
    if (b.type === "thinking") {
      // 只保留 signature（如果有），去掉 thinking 内容
      return { type: "thinking", thinking: "", signature: b.signature };
    }
    return b;
  });
}

export function hasThinkingSignature(blocks: CanonicalContentBlock[]): boolean {
  return blocks.some((b) => b.type === "thinking" && b.signature);
}
