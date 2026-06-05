import * as p from "@clack/prompts";

/**
 * 检查是否取消操作
 */
export function checkCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }
  return value as T;
}

/**
 * 掩码 token（前 4 + 后 4 可见，中间显示实际位数的 *）
 */
export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "*".repeat(token.length);
  const midLen = token.length - 8;
  return `${token.slice(0, 4)}${"•".repeat(midLen)}${token.slice(-4)}`;
}

/**
 * 通用确认 prompt
 */
export async function confirm(message: string, initial = false): Promise<boolean> {
  return checkCancel(
    await p.confirm({
      message,
      initialValue: initial,
    }),
  );
}
