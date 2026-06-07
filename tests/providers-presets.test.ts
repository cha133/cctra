// ============================================================================
// Vendor 预设单元测试
// ============================================================================
import { describe, test, expect } from "bun:test";
import {
  providerPresets,
  getEndpointForFormat,
  getSupportedApiFormats,
  getVendorChoices,
  generateProfileName,
  NO_VENDOR,
  type ProviderPreset,
} from "../src/providers/presets";
import type { ApiFormat } from "../src/canonical/types";

const ALL_FORMATS: ApiFormat[] = ["openai-chat", "openai-responses", "anthropic-messages"];

describe("generateProfileName", () => {
  test("simple vendor name → kebab-case", () => {
    expect(generateProfileName("Ark Agent Plan")).toBe("ark-agent-plan");
  });

  test("replaces dots and special chars with hyphens", () => {
    expect(generateProfileName("APIKEY.FUN")).toBe("apikey-fun");
  });

  test("strips parens", () => {
    expect(generateProfileName("Xiaomi MiMo Token Plan (China)")).toBe(
      "xiaomi-mimo-token-plan-china",
    );
  });

  test("merges consecutive hyphens", () => {
    expect(generateProfileName("Foo--Bar")).toBe("foo-bar");
  });

  test("trims leading/trailing hyphens", () => {
    expect(generateProfileName("---Hello---")).toBe("hello");
  });

  test("lowercases everything", () => {
    expect(generateProfileName("UPPERCASE")).toBe("uppercase");
  });

  test("handles empty string", () => {
    expect(generateProfileName("")).toBe("");
  });
});

describe("getVendorChoices", () => {
  test("first entry is '(不使用供应商)'", () => {
    const choices = getVendorChoices();
    expect(choices[0]).toBe(NO_VENDOR);
    expect(choices[0]?.name).toBe("(不使用供应商)");
  });

  test("includes all providerPresets", () => {
    const choices = getVendorChoices();
    expect(choices.length).toBe(providerPresets.length + 1);
  });

  test("NO_VENDOR has no endpoints", () => {
    expect(NO_VENDOR.endpoints).toEqual({});
  });

  test("NO_VENDOR supports all api formats", () => {
    expect(getSupportedApiFormats(NO_VENDOR)).toEqual(ALL_FORMATS);
  });
});

describe("providerPresets data integrity", () => {
  test("has at least 50 vendors", () => {
    expect(providerPresets.length).toBeGreaterThanOrEqual(50);
  });

  test("all names are unique", () => {
    const names = providerPresets.map((p) => p.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  test("all vendors have at least one endpoint", () => {
    for (const p of providerPresets) {
      expect(Object.keys(p.endpoints).length).toBeGreaterThan(0);
    }
  });

  test("all endpoints start with https://", () => {
    for (const p of providerPresets) {
      for (const endpoint of Object.values(p.endpoints)) {
        expect(endpoint).toMatch(/^https:\/\//);
      }
    }
  });

  test("all endpoint keys are valid ApiFormat", () => {
    for (const p of providerPresets) {
      for (const format of Object.keys(p.endpoints)) {
        expect(ALL_FORMATS).toContain(format as ApiFormat);
      }
    }
  });

  test("all names are non-empty", () => {
    for (const p of providerPresets) {
      expect(p.name.trim().length).toBeGreaterThan(0);
    }
  });

  test("includes all 3 apiFormat categories", () => {
    const formats = new Set(providerPresets.flatMap((p) => Object.keys(p.endpoints)));
    expect(formats.has("anthropic-messages")).toBe(true);
    expect(formats.has("openai-chat")).toBe(true);
    expect(formats.has("openai-responses")).toBe(true);
  });

  test("anthropic-messages is the dominant format", () => {
    const anthropic = providerPresets.filter((p) => p.endpoints["anthropic-messages"]);
    expect(anthropic.length).toBeGreaterThan(40);
  });

  test("many vendors support dual protocol (Anthropic + OpenAI Chat)", () => {
    const dualChat = providerPresets.filter(
      (p) => p.endpoints["anthropic-messages"] && p.endpoints["openai-chat"],
    );
    expect(dualChat.length).toBeGreaterThan(35);
  });

  test("a few vendors support Anthropic + OpenAI Responses", () => {
    const dualResponses = providerPresets.filter(
      (p) => p.endpoints["anthropic-messages"] && p.endpoints["openai-responses"],
    );
    expect(dualResponses.length).toBeGreaterThanOrEqual(5);
  });
});

describe("protocol-scoped presets", () => {
  test("Ark Agent Plan supports Anthropic + OpenAI Chat only", () => {
    const preset = providerPresets.find((p) => p.name === "Ark Agent Plan");
    expect(preset).toBeDefined();
    expect(getSupportedApiFormats(preset!)).toEqual(["anthropic-messages", "openai-chat"]);
    expect(getEndpointForFormat(preset!, "anthropic-messages")).toBe("https://ark.cn-beijing.volces.com/api/plan");
    expect(getEndpointForFormat(preset!, "openai-chat")).toBe("https://ark.cn-beijing.volces.com/api/plan/v3");
    expect(getEndpointForFormat(preset!, "openai-responses")).toBe("");
  });

  test("Ark Coding Plan supports Anthropic + OpenAI Chat only", () => {
    const preset = providerPresets.find((p) => p.name === "Ark Coding Plan");
    expect(preset).toBeDefined();
    expect(getSupportedApiFormats(preset!)).toEqual(["anthropic-messages", "openai-chat"]);
    expect(getEndpointForFormat(preset!, "anthropic-messages")).toBe("https://ark.cn-beijing.volces.com/api/coding");
    expect(getEndpointForFormat(preset!, "openai-chat")).toBe("https://ark.cn-beijing.volces.com/api/coding/v3");
  });

  test("DeepSeek supports Anthropic + OpenAI Chat with correct endpoints", () => {
    const preset = providerPresets.find((p) => p.name === "DeepSeek");
    expect(preset).toBeDefined();
    expect(getSupportedApiFormats(preset!)).toEqual(["anthropic-messages", "openai-chat"]);
    expect(getEndpointForFormat(preset!, "anthropic-messages")).toBe("https://api.deepseek.com/anthropic");
    expect(getEndpointForFormat(preset!, "openai-chat")).toBe("https://api.deepseek.com");
  });

  test("APIKEY.FUN supports Anthropic + OpenAI Responses", () => {
    const preset = providerPresets.find((p) => p.name === "APIKEY.FUN");
    expect(preset).toBeDefined();
    expect(getSupportedApiFormats(preset!)).toEqual(["anthropic-messages", "openai-responses"]);
    expect(getEndpointForFormat(preset!, "openai-responses")).toBe("https://api.apikey.fun/v1");
  });
});

describe("known vendors present", () => {
  const expected: Array<{ name: string; has: ApiFormat[] }> = [
    { name: "DeepSeek", has: ["anthropic-messages", "openai-chat"] },
    { name: "Zhipu GLM", has: ["anthropic-messages", "openai-chat"] },
    { name: "Kimi", has: ["anthropic-messages", "openai-chat"] },
    { name: "MiniMax", has: ["anthropic-messages", "openai-chat"] },
    { name: "OpenAI Official", has: ["openai-chat"] },
    { name: "Gemini OpenAI-Compat", has: ["openai-responses"] },
    { name: "OpenRouter", has: ["anthropic-messages", "openai-chat"] },
    { name: "Codex (ChatGPT Plus/Pro)", has: ["openai-responses"] },
    { name: "OpenCode Go", has: ["openai-chat"] },
    { name: "Bailian", has: ["anthropic-messages", "openai-chat"] },
    { name: "Shengsuanyun", has: ["anthropic-messages", "openai-chat"] },
    { name: "AtlasCloud", has: ["anthropic-messages", "openai-chat"] },
    { name: "E-FlowCode", has: ["anthropic-messages", "openai-responses"] },
  ];

  for (const { name, has } of expected) {
    test(`${name} exists with correct protocols`, () => {
      const preset = providerPresets.find((p) => p.name === name);
      expect(preset).toBeDefined();
      const formats = getSupportedApiFormats(preset!);
      for (const fmt of has) {
        expect(formats).toContain(fmt);
        expect(preset!.endpoints[fmt]).toBeTruthy();
      }
    });
  }
});

describe("preset type", () => {
  test("ProviderPreset shape is what add.ts expects", () => {
    const sample: ProviderPreset = {
      name: "Test",
      endpoints: {
        "anthropic-messages": "https://example.com/anthropic",
        "openai-chat": "https://example.com/v1",
      },
      notes: "test note",
    };
    expect(sample.name).toBe("Test");
    expect(sample.endpoints["anthropic-messages"]).toBe("https://example.com/anthropic");
    expect(sample.endpoints["openai-chat"]).toBe("https://example.com/v1");
    expect(sample.notes).toBe("test note");
  });
});
