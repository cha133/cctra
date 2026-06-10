// ============================================================================
// Auto-alias 决策单元测
// ============================================================================
import { describe, test, expect } from "bun:test";
import { canAutoAlias, resolveAutoAlias } from "../src/core/alias";
import type { Config, Model } from "../src/types";

function emptyConfig(): Config {
  return { port: 3133, subscriptions: {}, plugins: {} };
}

function configWithSub(
  subName: string,
  models: Array<{ id: string; alias?: string }>,
): Config {
  return {
    port: 3133,
    subscriptions: {
      [subName]: {
        kind: "subscription",
        name: subName,
        endpoint: "https://example.com",
        token: "t",
        apiFormat: "openai-chat",
        createdAt: 0,
        updatedAt: 0,
        models: models.map((m) => ({ id: m.id, alias: m.alias })),
      },
    },
    plugins: {},
  };
}

describe("canAutoAlias", () => {
  test("empty config: any id is auto-aliasable", () => {
    expect(canAutoAlias("foo", emptyConfig())).toBe(true);
  });

  test("id unique in config: auto-aliasable", () => {
    const cfg = configWithSub("a", [{ id: "model-a" }]);
    expect(canAutoAlias("model-b", cfg)).toBe(true);
  });

  test("id already used as id in other source: blocked", () => {
    const cfg = configWithSub("a", [{ id: "deepseek-v4-pro" }]);
    expect(canAutoAlias("deepseek-v4-pro", cfg)).toBe(false);
  });

  test("id already used as alias in other source: blocked", () => {
    const cfg = configWithSub("a", [{ id: "d4", alias: "deepseek-v4-pro" }]);
    expect(canAutoAlias("deepseek-v4-pro", cfg)).toBe(false);
  });

  test("id used in same source: not blocked (excludeSource)", () => {
    const cfg = configWithSub("a", [{ id: "model-a" }]);
    // 在 a 这个 source 内加另一个 model-a：应允许（excludeSource=a 跳过自己）
    expect(canAutoAlias("model-a", cfg, "a")).toBe(true);
  });

  test("empty id: never auto-aliasable", () => {
    expect(canAutoAlias("", emptyConfig())).toBe(false);
  });

  test("disabled plugin's models don't block", () => {
    const cfg: Config = {
      port: 3133,
      subscriptions: {},
      plugins: {
        p: {
          kind: "plugin",
          name: "p",
          path: "/x.js",
          config: {},
          enabled: false,
          models: [{ id: "blocked" }],
        },
      },
    };
    expect(canAutoAlias("blocked", cfg)).toBe(true);
  });
});

describe("resolveAutoAlias", () => {
  test("globally unique: returns id", () => {
    const cfg = configWithSub("a", [{ id: "existing" }]);
    expect(resolveAutoAlias("new", cfg)).toBe("new");
  });

  test("id collision: returns undefined", () => {
    const cfg = configWithSub("a", [{ id: "x" }]);
    expect(resolveAutoAlias("x", cfg)).toBeUndefined();
  });

  test("alias collision: returns undefined", () => {
    const cfg = configWithSub("a", [{ id: "y", alias: "x" }]);
    expect(resolveAutoAlias("x", cfg)).toBeUndefined();
  });

  test("in-batch collision: first wins, second is undefined", () => {
    const cfg = emptyConfig();
    const batch: Model[] = [];
    // 模拟 add 流程：连续 add 2 个同名 model
    const first = resolveAutoAlias("dup", cfg, batch);
    batch.push({ id: "dup", alias: first });
    const second = resolveAutoAlias("dup", cfg, batch);
    expect(first).toBe("dup");
    expect(second).toBeUndefined();
  });

  test("in-batch with different ids: both auto-aliased", () => {
    const cfg = emptyConfig();
    const batch: Model[] = [];
    expect(resolveAutoAlias("a", cfg, batch)).toBe("a");
    batch.push({ id: "a", alias: "a" });
    expect(resolveAutoAlias("b", cfg, batch)).toBe("b");
  });
});
