// ============================================================================
// HTTP 服务器 + 模型解析集成测试
// ============================================================================
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startServer } from "../src/server/serve";
import { resolveModelRef } from "../src/core/resolve";
import { loadConfigFile, saveConfigFile } from "../src/core/config";
import { configTomlPath, ensureCctraDir } from "../src/utils/paths";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

let serverHandle: { port: number; stop: () => void } | null = null;
let originalConfig: string | null = null;
const TEST_CONFIG = `
port = 31444

[subscriptions.test-sub]
name = "test-sub"
endpoint = "https://example.com"
token = "test-token"
apiFormat = "openai-chat"
createdAt = 1700000000000
updatedAt = 1700000000000

[[subscriptions.test-sub.models]]
id = "model-a"

[[subscriptions.test-sub.models]]
id = "model-b"
alias = "b-alias"

[tiers.cctra-pro]
name = "cctra-pro"
target = "test-sub/model-a"
description = "test"
`;

beforeAll(() => {
  // 备份并替换 ~/.cctra/config.toml
  const path = configTomlPath();
  if (existsSync(path)) {
    originalConfig = readFileSync(path, "utf-8");
  }
  ensureCctraDir();
  writeFileSync(path, TEST_CONFIG, "utf-8");
  serverHandle = startServer();
});

afterAll(() => {
  serverHandle?.stop();
  // 还原
  const path = configTomlPath();
  if (originalConfig !== null) {
    writeFileSync(path, originalConfig, "utf-8");
  } else if (existsSync(path)) {
    // 测试期间没有原 config；保留测试 config 不删
  }
});

describe("HTTP server", () => {
  test("healthz", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/healthz`);
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  test("models list", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/models`);
    expect(res.status).toBe(200);
    const data = await res.json() as { data: Array<{ id: string }> };
    const ids = data.data.map((m) => m.id);
    expect(ids).toContain("cctra-pro");
    expect(ids).toContain("test-sub/model-a");
    expect(ids).toContain("test-sub/b-alias");
  });

  test("chat completions without model → 400", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("chat completions with invalid model → 400", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nonexistent", messages: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("root path → 404", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/`);
    expect(res.status).toBe(404);
  });

  test("CORS preflight → 204", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/chat/completions`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(204);
  });

  test("messages endpoint accepts POST", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nonexistent", messages: [] }),
    });
    // 没有 model → 400 (说明到达了 handler，不是 404)
    expect(res.status).toBe(400);
  });

  test("responses endpoint accepts POST", async () => {
    const res = await fetch(`http://127.0.0.1:${serverHandle!.port}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nonexistent" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Model resolve", () => {
  test("tier resolves to sub/model", () => {
    const config = loadConfigFile();
    const r = resolveModelRef("cctra-pro", config);
    expect(r?.source.name).toBe("test-sub");
    expect(r?.modelId).toBe("model-a");
  });

  test("sub/model with alias", () => {
    const config = loadConfigFile();
    const r = resolveModelRef("test-sub/b-alias", config);
    expect(r?.modelId).toBe("model-b");
  });

  test("sub/model with id", () => {
    const config = loadConfigFile();
    const r = resolveModelRef("test-sub/model-a", config);
    expect(r?.modelId).toBe("model-a");
  });

  test("global alias", () => {
    const config = loadConfigFile();
    const r = resolveModelRef("b-alias", config);
    expect(r?.modelId).toBe("model-b");
  });

  test("unmapped tier returns null", () => {
    const config = loadConfigFile();
    const r = resolveModelRef("cctra-flash", config);
    expect(r).toBeNull();
  });

  test("unknown model returns null", () => {
    const config = loadConfigFile();
    const r = resolveModelRef("unknown", config);
    expect(r).toBeNull();
  });
});

// 避免 unused import 警告
void saveConfigFile;
