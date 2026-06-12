// ============================================================================
// Migration 测试：legacy Model.alias → Config.aliases 的迁移幂等性
// ============================================================================
import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigFile, saveConfigFile } from "../src/core/config";

let tempDir: string;
let tempPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cctra-migrate-"));
  tempPath = join(tempDir, "config.toml");
  process.env.CCTRA_CONFIG = tempPath;
});

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  delete process.env.CCTRA_CONFIG;
});

describe("loadConfigFile — migrate legacy Model.alias", () => {
  test("Model.alias 搬到 config.aliases，并从 model 删除", () => {
    writeFileSync(
      tempPath,
      `
port = 3133

[providers.ark]
name = "ark"
endpoint = "https://ark.com"
token = "t"
apiFormat = "openai-chat"
createdAt = 1
updatedAt = 1

[[providers.ark.models]]
id = "doubao-pro"
alias = "pro"

[[providers.ark.models]]
id = "doubao-flash"
`.trim(),
    );
    const cfg = loadConfigFile();
    expect(cfg.aliases["pro"]).toBe("ark/doubao-pro");
    // Model.alias 不应再出现
    expect((cfg.providers.ark!.models[0] as unknown as { alias?: string }).alias).toBeUndefined();
    expect((cfg.providers.ark!.models[1] as unknown as { alias?: string }).alias).toBeUndefined();
  });

  test("不覆盖用户已写的同名 alias", () => {
    writeFileSync(
      tempPath,
      `
port = 3133

[aliases]
pro = "manual-source/x"

[providers.ark]
name = "ark"
endpoint = "https://ark.com"
token = "t"
apiFormat = "openai-chat"
createdAt = 1
updatedAt = 1

[[providers.ark.models]]
id = "doubao-pro"
alias = "pro"
`.trim(),
    );
    const cfg = loadConfigFile();
    expect(cfg.aliases["pro"]).toBe("manual-source/x");
  });

  test("二次 load 幂等 + save → load round-trip 不再有 Model.alias", () => {
    writeFileSync(
      tempPath,
      `
port = 3133

[providers.ark]
name = "ark"
endpoint = "https://ark.com"
token = "t"
apiFormat = "openai-chat"
createdAt = 1
updatedAt = 1

[[providers.ark.models]]
id = "doubao-pro"
alias = "pro"
`.trim(),
    );
    const cfg1 = loadConfigFile();
    saveConfigFile(cfg1);
    const cfg2 = loadConfigFile();
    expect(cfg2.aliases["pro"]).toBe("ark/doubao-pro");
    expect((cfg2.providers.ark!.models[0] as unknown as { alias?: string }).alias).toBeUndefined();
    // 再来一遍
    saveConfigFile(cfg2);
    const cfg3 = loadConfigFile();
    expect(cfg3).toEqual(cfg2);
  });

  test("空文件 → DEFAULT_CONFIG（含 3 个默认空 alias）", () => {
    // 文件不存在的情况
    rmSync(tempPath, { force: true });
    const cfg = loadConfigFile();
    expect(cfg.aliases["cctra-pro"]).toBe("");
    expect(cfg.aliases["cctra-flash"]).toBe("");
    expect(cfg.aliases["cctra-vision"]).toBe("");
  });

  test("老 config 无 [aliases] 段 → 注入 3 个默认空槽位", () => {
    writeFileSync(
      tempPath,
      `
port = 3133

[providers.ark]
name = "ark"
endpoint = "https://ark.com"
token = "t"
apiFormat = "openai-chat"
createdAt = 1
updatedAt = 1
`.trim(),
    );
    const cfg = loadConfigFile();
    expect(cfg.aliases["cctra-pro"]).toBe("");
  });

  test("plugin 的 Model.alias 同样被迁", () => {
    writeFileSync(
      tempPath,
      `
port = 3133

[plugins.myp]
name = "myp"
path = "/x.js"
config = {}
enabled = true

[[plugins.myp.models]]
id = "m1"
alias = "p1"
`.trim(),
    );
    const cfg = loadConfigFile();
    expect(cfg.aliases["p1"]).toBe("myp/m1");
    expect((cfg.plugins.myp!.models[0] as unknown as { alias?: string }).alias).toBeUndefined();
  });
});
