// ============================================================================
// Alias 系统单元测试：auto-register 算法、resolve 表分支、namespace 防御
// ============================================================================

// 关掉 XDG migration，防止 test 触碰用户真实 ~/.cctra/
process.env.CCTRA_NO_MIGRATE = "1";

import { describe, test, expect } from "bun:test";
import { canAutoRegisterAlias, autoAliasValue } from "../src/core/alias";
import { resolveModelRef, ResolveError } from "../src/core/resolve";
import {
  isAliasName,
  isSourceName,
  isValidAliasName,
  nameTakenAnywhere,
} from "../src/core/namespace";
import type { Config, Model } from "../src/types";

function emptyConfig(): Config {
  return { port: 3133, providers: {}, plugins: {}, aliases: {} };
}

function configWithProvider(
  providerName: string,
  modelIds: string[],
  aliases: Record<string, string> = {},
): Config {
  return {
    port: 3133,
    providers: {
      [providerName]: {
        kind: "provider",
        name: providerName,
        endpoint: "https://example.com",
        token: "t",
        apiFormat: "openai-chat",
        createdAt: 0,
        updatedAt: 0,
        models: modelIds.map((id) => ({ id })),
      },
    },
    plugins: {},
    aliases,
  };
}

// ---------------------------------------------------------------------------

describe("canAutoRegisterAlias", () => {
  test("empty config: any id auto-registers", () => {
    expect(canAutoRegisterAlias("foo", emptyConfig())).toBe(true);
  });

  test("id unique in config: auto-registers", () => {
    const cfg = configWithProvider("a", ["model-a"]);
    expect(canAutoRegisterAlias("model-b", cfg)).toBe(true);
  });

  test("id collides with existing alias name: blocked", () => {
    const cfg = configWithProvider("a", ["model-a"], { foo: "a/model-a" });
    expect(canAutoRegisterAlias("foo", cfg)).toBe(false);
  });

  test("id collides with source name: blocked", () => {
    const cfg = configWithProvider("a", ["model-a"]);
    expect(canAutoRegisterAlias("a", cfg)).toBe(false);
  });

  test("id already used as model.id in other source: blocked", () => {
    const cfg: Config = {
      ...configWithProvider("a", ["dup"]),
    };
    cfg.providers.b = {
      kind: "provider",
      name: "b",
      endpoint: "x",
      token: "t",
      apiFormat: "openai-chat",
      createdAt: 0,
      updatedAt: 0,
      models: [{ id: "dup" }],
    };
    expect(canAutoRegisterAlias("dup", cfg)).toBe(false);
  });

  test("empty id: never auto-registers", () => {
    expect(canAutoRegisterAlias("", emptyConfig())).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("autoAliasValue", () => {
  test("globally unique: returns provider/id", () => {
    const cfg = configWithProvider("ark", ["model-a"]);
    expect(autoAliasValue("new-id", "ark", cfg)).toBe("ark/new-id");
  });

  test("collides with alias: returns null", () => {
    const cfg = configWithProvider("ark", ["model-a"], { existing: "ark/model-a" });
    expect(autoAliasValue("existing", "ark", cfg)).toBeNull();
  });

  test("in-batch dedup", () => {
    const cfg = emptyConfig();
    const batch: Model[] = [];
    expect(autoAliasValue("dup", "p", cfg, batch)).toBe("p/dup");
    batch.push({ id: "dup" });
    expect(autoAliasValue("dup", "p", cfg, batch)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("resolveModelRef — alias table branch", () => {
  test("alias bound → routes to source/model", () => {
    const cfg = configWithProvider("ark", ["doubao"], { "cctra-pro": "ark/doubao" });
    const r = resolveModelRef("cctra-pro", cfg);
    expect(r?.source.name).toBe("ark");
    expect(r?.modelId).toBe("doubao");
  });

  test("alias unbound (value '') → throws is unbound", () => {
    const cfg = configWithProvider("ark", ["doubao"], { "cctra-pro": "" });
    expect(() => resolveModelRef("cctra-pro", cfg)).toThrow(/is unbound/);
  });

  test("alias points to missing model → throws missing model", () => {
    const cfg = configWithProvider("ark", ["doubao"], { "cctra-pro": "ark/gone" });
    expect(() => resolveModelRef("cctra-pro", cfg)).toThrow(/missing model/);
  });

  test("alias points to unknown source → throws unknown source", () => {
    const cfg = configWithProvider("ark", ["doubao"], { "cctra-pro": "ghost/doubao" });
    expect(() => resolveModelRef("cctra-pro", cfg)).toThrow(/unknown source/);
  });

  test("alias with invalid value (no slash) → throws invalid", () => {
    const cfg = configWithProvider("ark", ["doubao"], { "cctra-pro": "broken" });
    expect(() => resolveModelRef("cctra-pro", cfg)).toThrow(/invalid value/);
  });

  test("provider/model fall-through still works alongside aliases", () => {
    const cfg = configWithProvider("ark", ["doubao"], { "cctra-pro": "ark/doubao" });
    const r = resolveModelRef("ark/doubao", cfg);
    expect(r?.source.name).toBe("ark");
    expect(r?.modelId).toBe("doubao");
  });

  test("ResolveError is thrown (instanceof check)", () => {
    const cfg = configWithProvider("ark", ["doubao"], { "cctra-pro": "" });
    try {
      resolveModelRef("cctra-pro", cfg);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ResolveError);
    }
  });
});

// ---------------------------------------------------------------------------

describe("namespace helpers", () => {
  test("isSourceName / isAliasName / nameTakenAnywhere", () => {
    const cfg = configWithProvider("ark", ["doubao"], { foo: "ark/doubao" });
    expect(isSourceName(cfg, "ark")).toBe(true);
    expect(isSourceName(cfg, "foo")).toBe(false);
    expect(isAliasName(cfg, "foo")).toBe(true);
    expect(isAliasName(cfg, "ark")).toBe(false);
    expect(nameTakenAnywhere(cfg, "ark")).toBe(true);
    expect(nameTakenAnywhere(cfg, "foo")).toBe(true);
    expect(nameTakenAnywhere(cfg, "free")).toBe(false);
  });

  test("isValidAliasName", () => {
    expect(isValidAliasName("cctra-pro")).toBe(true);
    expect(isValidAliasName("a")).toBe(true);
    expect(isValidAliasName("9-init")).toBe(true);
    expect(isValidAliasName("")).toBe(false);
    expect(isValidAliasName("-leading-dash")).toBe(false);
    expect(isValidAliasName("UPPER")).toBe(false);
    expect(isValidAliasName("with/slash")).toBe(false);
    expect(isValidAliasName("a".repeat(64))).toBe(false); // > 63 chars
    expect(isValidAliasName("a".repeat(63))).toBe(true);
  });
});
