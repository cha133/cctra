// ============================================================================
// switch 命令的核心逻辑测试（绕过 prompts，走 switchAliasOrThrow 纯函数路径）
// ============================================================================
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { switchAliasOrThrow } from "../src/commands/switch";
import { loadConfigFile } from "../src/core/config";

let tempDir: string;
let tempPath: string;

const FIXTURE = `
port = 3133

[aliases]
"cctra-pro" = ""
"cctra-flash" = ""

[providers.ark]
name = "ark"
endpoint = "https://ark.com"
token = "t"
apiFormat = "openai-chat"
createdAt = 1
updatedAt = 1

[[providers.ark.models]]
id = "doubao-pro"

[[providers.ark.models]]
id = "doubao-flash"

[providers.deep]
name = "deep"
endpoint = "https://deep.com"
token = "t"
apiFormat = "openai-chat"
createdAt = 1
updatedAt = 1

[[providers.deep.models]]
id = "r1"
`.trim();

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "cctra-switch-"));
  tempPath = join(tempDir, "config.toml");
  process.env.CCTRA_CONFIG = tempPath;
  writeFileSync(tempPath, FIXTURE, "utf-8");
});

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  delete process.env.CCTRA_CONFIG;
});

describe("switchAliasOrThrow", () => {
  test("bind existing alias to provider/model", () => {
    switchAliasOrThrow("cctra-pro", "ark/doubao-pro", false);
    const cfg = loadConfigFile();
    expect(cfg.aliases["cctra-pro"]).toBe("ark/doubao-pro");
  });

  test("bad target → throws", () => {
    expect(() => switchAliasOrThrow("cctra-pro", "ghost/none", false)).toThrow(
      /does not resolve|unknown source|missing model|invalid value/,
    );
  });

  test("empty target → throws", () => {
    expect(() => switchAliasOrThrow("cctra-pro", "   ", false)).toThrow(/Empty/);
  });

  test("self-binding no-op when alias already points to same target", () => {
    switchAliasOrThrow("cctra-pro", "ark/doubao-pro", false);
    const before = loadConfigFile().aliases["cctra-pro"];
    // 再次切到一样的 target
    switchAliasOrThrow("cctra-pro", "ark/doubao-pro", false);
    const after = loadConfigFile().aliases["cctra-pro"];
    expect(after).toBe(before);
  });

  test("create new alias with isNew=true", () => {
    switchAliasOrThrow("my-pro", "deep/r1", true);
    const cfg = loadConfigFile();
    expect(cfg.aliases["my-pro"]).toBe("deep/r1");
  });

  test("create new alias colliding with source name → throws", () => {
    expect(() => switchAliasOrThrow("ark", "deep/r1", true)).toThrow(/already in use/);
  });

  test("create new alias with invalid name → throws", () => {
    expect(() => switchAliasOrThrow("UPPER", "deep/r1", true)).toThrow(/Invalid/);
  });

  test("switching an alias to a different model overwrites", () => {
    switchAliasOrThrow("cctra-pro", "ark/doubao-pro", false);
    switchAliasOrThrow("cctra-pro", "ark/doubao-flash", false);
    expect(loadConfigFile().aliases["cctra-pro"]).toBe("ark/doubao-flash");
  });

  test("target accepts another alias name (resolves recursively to fullname stored)", () => {
    // 先建一个 alias "pro" → ark/doubao-pro
    switchAliasOrThrow("pro", "ark/doubao-pro", true);
    // 然后用 alias 作 target
    switchAliasOrThrow("cctra-pro", "pro", false);
    // 写入应是规范化的 provider/model，不是 alias
    expect(loadConfigFile().aliases["cctra-pro"]).toBe("ark/doubao-pro");
  });
});
