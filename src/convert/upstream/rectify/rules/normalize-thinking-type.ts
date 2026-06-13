// ============================================================================
// normalize-thinking-type
// ----------------------------------------------------------------------------
// 把 Anthropic top-level `thinking.type` 归一为字符串 "enabled" / "disabled"。
//
// 适用场景：Kimi 的 anthropic-messages 兼容端点（api.moonshot.cn/anthropic）
// 只接受 `thinking: { type: "enabled", budget_tokens: N }` 这种规范字符串，
// 拒绝 Claude Code 等客户端发的 effort 速记（"high" / "medium" / "low" / "xhigh" / "max" / "adaptive"）
// 也拒绝布尔 `true` / `false`。
//
// 策略：任何非显式 `"disabled"` 的值 → `"enabled"`，这样未来上游出新 effort 名
// 也自动兼容，不用每加一个就改这条规则。布尔 `true` 也归一到 `"enabled"`。
//
// 注：此规则只动 anthropic-messages 上游的 wire body。其他协议（chat / responses）
// 没有同名字段，直接 no-op 跳过。
// ============================================================================
import type { RectifyRule } from "../registry";

const normalizeThinkingType: RectifyRule = {
  id: "normalize-thinking-type",
  displayName: "Normalize thinking.type to enabled/disabled string",
  description:
    "Coerce Anthropic `thinking.type` to \"enabled\" / \"disabled\" string. For vendors (e.g. Kimi anthropic-messages endpoint) that only accept those literal strings, not booleans and not effort shorthand like \"high\"/\"medium\"/\"low\"/\"xhigh\".",
  fn(body, ctx) {
    if (ctx.apiFormat !== "anthropic-messages") return;
    const t = (body as { thinking?: { type?: unknown } }).thinking;
    if (!t) return;
    if (typeof t.type === "string" && t.type.toLowerCase() === "disabled") return; // 已经是 disabled
    if (t.type === false || t.type === null) {
      t.type = "disabled";
      return;
    }
    // 字符串 enabled / 任何 effort shorthand (high/medium/low/xhigh/max/...) / 布尔 true / 数字 → "enabled"
    t.type = "enabled";
  },
};

export default normalizeThinkingType;