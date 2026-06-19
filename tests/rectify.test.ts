// ============================================================================
// 整流 (rectify) 单元测试
// ----------------------------------------------------------------------------
// 隔离：CCTRA_CONFIG 指向 mkdtempSync 临时目录（与 tests/server.test.ts 同模式）
// ============================================================================

// 关掉 XDG migration，防止 test 触碰用户真实 ~/.cctra/
process.env.CCTRA_NO_MIGRATE = "1";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runRectifiers } from "../src/convert/upstream/rectify";
import { BUILTIN_RULES, BUILTIN_RULE_IDS } from "../src/convert/upstream/rectify/registry";
import type { ApiFormat } from "../src/canonical/types";
import type { Source } from "../src/types";

let tempDir: string;
let tempConfigPath: string;

function writeToml(content: string): void {
  writeFileSync(tempConfigPath, content, "utf-8");
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cctra-rectify-"));
  tempConfigPath = join(tempDir, "config.toml");
  process.env.CCTRA_CONFIG = tempConfigPath;
});

afterAll(() => {
  delete process.env.CCTRA_CONFIG;
  rmSync(tempDir, { recursive: true, force: true });
});

function makeProvider(name: string): Source {
  return {
    kind: "provider",
    name,
    models: [],
    endpoint: "https://example.invalid",
    token: "test",
    apiFormat: "anthropic-messages",
    createdAt: 0,
    updatedAt: 0,
  } as Source;
}

function makePluginSource(name: string): Source {
  return {
    kind: "plugin",
    name,
    models: [],
    path: "/dev/null",
    config: {},
    enabled: true,
  } as Source;
}

// 测试用 body 形状：thinking.type 故意 unknown，让 rule mutate 后能赋值任意类型
type RectifyBody = { thinking?: { type?: unknown; budget_tokens?: number }; model?: string };
const ctx = { source: makeProvider("kimi"), apiFormat: "anthropic-messages" as ApiFormat };

// TOML 配置 helper — config.rectify 段 + 一个 anthropic-messages provider
// 关键：Config.rectify.providers 是 Record<string, string[]>，所以 TOML 写法是
//   [rectify.providers]
//   "kimi" = ["normalize-thinking-type"]
// 不能写成 [rectify.providers.kimi] rules = [...]（那会变成对象嵌套）
function buildToml(opts: {
  globalEnabled: boolean;
  attachKimi: boolean;
  attachMyPlugin?: boolean;
  hasPlugin?: boolean;
  omitRectify?: boolean;
}): string {
  const lines: string[] = [];
  lines.push(`[providers.kimi]`);
  lines.push(`kind = "provider"`);
  lines.push(`endpoint = "https://example.invalid"`);
  lines.push(`token = "test"`);
  lines.push(`apiFormat = "anthropic-messages"`);
  lines.push(`createdAt = 0`);
  lines.push(`updatedAt = 0`);
  if (opts.hasPlugin) {
    lines.push("");
    lines.push(`[plugins.my-plugin]`);
    lines.push(`kind = "plugin"`);
    lines.push(`path = "/dev/null"`);
    lines.push(`config = {}`);
    lines.push(`enabled = true`);
  }
  if (opts.omitRectify) return lines.join("\n") + "\n";
  lines.push("");
  lines.push(`[rectify.rules]`);
  lines.push(`"normalize-thinking-type" = ${opts.globalEnabled}`);
  lines.push("");
  lines.push(`[rectify.providers]`);
  const entries: string[] = [];
  if (opts.attachKimi) entries.push(`"kimi" = ["normalize-thinking-type"]`);
  if (opts.attachMyPlugin) entries.push(`"my-plugin" = ["normalize-thinking-type"]`);
  if (entries.length === 0) {
    // 没 attach 时也写一个空数组占位让 schema 一致；实际场景下整段不写更干净
  }
  for (const e of entries) lines.push(e);
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// normalize-thinking-type 规则单元测试（直接调 fn，不走 config gating）
// ---------------------------------------------------------------------------

describe("normalize-thinking-type rule", () => {
  const rule = BUILTIN_RULES.find((r) => r.id === "normalize-thinking-type")!;

  test("已存在的 BUILTIN_RULES 里只有一条", () => {
    expect(BUILTIN_RULES).toHaveLength(1);
    expect(BUILTIN_RULE_IDS.has("normalize-thinking-type")).toBe(true);
  });

  test("effort shorthand \"high\"/\"medium\"/\"low\" → \"enabled\"", () => {
    for (const v of ["high", "medium", "low", "xhigh", "max", "adaptive"]) {
      const body: RectifyBody = { thinking: { type: v, budget_tokens: 1024 } };
      rule.fn(body, ctx);
      expect(body.thinking!.type).toBe("enabled");
    }
  });

  test("布尔 true → \"enabled\"", () => {
    const body: RectifyBody = { thinking: { type: true } };
    rule.fn(body, ctx);
    expect(body.thinking!.type).toBe("enabled");
  });

  test("布尔 false → \"disabled\"", () => {
    const body: RectifyBody = { thinking: { type: false } };
    rule.fn(body, ctx);
    expect(body.thinking!.type).toBe("disabled");
  });

  test("null → \"disabled\"", () => {
    const body: RectifyBody = { thinking: { type: null } };
    rule.fn(body, ctx);
    expect(body.thinking!.type).toBe("disabled");
  });

  test("字符串 \"disabled\"/\"off\" → \"enabled\"（激进策略：非显式 disabled 字面都归一）", () => {
    // 注意：v1 策略是「任何非显式 \"disabled\" 字面 → \"enabled\"」，覆盖未来 effort 名
    // 包括大小写不敏感的字面 disabled 保持原样
    for (const v of ["disabled", "Disabled", "DISABLED"]) {
      const body: RectifyBody = { thinking: { type: v } };
      rule.fn(body, ctx);
      expect(body.thinking!.type).toBe(v);
    }
    // "off" 不在 disabled 字面集合里 → 归一到 "enabled"（激进策略）
    for (const v of ["off", "OFF", "Off"]) {
      const body: RectifyBody = { thinking: { type: v } };
      rule.fn(body, ctx);
      expect(body.thinking!.type).toBe("enabled");
    }
  });

  test("字符串 \"enabled\" 保持 \"enabled\"", () => {
    const body: RectifyBody = { thinking: { type: "enabled" } };
    rule.fn(body, ctx);
    expect(body.thinking!.type).toBe("enabled");
  });

  test("不存在的 thinking 字段 → no-op", () => {
    const body: RectifyBody = { model: "kimi/foo" };
    rule.fn(body, ctx);
    expect(body).toEqual({ model: "kimi/foo" });
  });

  test("非 anthropic-messages 上游 → 整条规则 no-op", () => {
    const body: RectifyBody = { thinking: { type: "high" } };
    const openaiCtx = { ...ctx, apiFormat: "openai-chat" as ApiFormat };
    rule.fn(body, openaiCtx);
    expect(body.thinking!.type).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// runRectifiers + config gating 集成测试
// ---------------------------------------------------------------------------

describe("runRectifiers config gating", () => {
  test("未 attach 的 provider → 规则不跑", () => {
    writeToml(buildToml({ globalEnabled: true, attachKimi: false }));
    const body: RectifyBody = { thinking: { type: "high" } };
    const result = runRectifiers(body, makeProvider("kimi"), "anthropic-messages");
    expect(result).toBe(body);
    expect(body.thinking!.type).toBe("high");
  });

  test("全局 disabled → 规则不跑（即使 attach 了）", () => {
    writeToml(buildToml({ globalEnabled: false, attachKimi: true }));
    const body: RectifyBody = { thinking: { type: "high" } };
    runRectifiers(body, makeProvider("kimi"), "anthropic-messages");
    expect(body.thinking!.type).toBe("high");
  });

  test("全局 enabled + provider attach → 规则跑", () => {
    writeToml(buildToml({ globalEnabled: true, attachKimi: true }));
    const body: RectifyBody = { thinking: { type: "high" } };
    runRectifiers(body, makeProvider("kimi"), "anthropic-messages");
    expect(body.thinking!.type).toBe("enabled");
  });

  test("plugin source → 永远不跑规则（即使全局 enabled + 即使 attach）", () => {
    writeToml(buildToml({
      globalEnabled: true,
      attachKimi: false,
      attachMyPlugin: true,
      hasPlugin: true,
    }));
    const body: RectifyBody = { thinking: { type: "high" } };
    runRectifiers(body, makePluginSource("my-plugin"), "anthropic-messages");
    expect(body.thinking!.type).toBe("high");
  });

  test("缺 [rectify] 段 → 行为零变化（向后兼容）", () => {
    writeToml(buildToml({ globalEnabled: true, attachKimi: true, omitRectify: true }));
    const body: RectifyBody = { thinking: { type: "high" } };
    runRectifiers(body, makeProvider("kimi"), "anthropic-messages");
    expect(body.thinking!.type).toBe("high");
  });

  test("规则 throw → log warn + 跳过本规则 + 不影响请求", () => {
    writeToml(buildToml({ globalEnabled: true, attachKimi: true }));
    const realBody = { thinking: { type: "high" } };
    const proxyBody = new Proxy(realBody, {
      get(target, prop) {
        if (prop === "thinking") throw new Error("boom");
        return Reflect.get(target, prop);
      },
    });
    // runRectifiers 不应 throw；rule 已 catch + skip
    expect(() => runRectifiers(proxyBody, makeProvider("kimi"), "anthropic-messages")).not.toThrow();
    // 验证原始 body 未被 mutate（因为 rule 在第一行访问就 throw 了）
    expect(realBody.thinking.type).toBe("high");
  });
});