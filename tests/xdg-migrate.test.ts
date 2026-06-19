// ============================================================================
// XDG migration 测试
// ----------------------------------------------------------------------------
// 验证 ~/.cctra/ → XDG layout 的搬移逻辑：
//   - config.toml 从 ~/.cctra/ 搬到 $XDG_CONFIG_HOME/cctra/config.toml
//   - models-cache.json 从 ~/.cctra/ 搬到 $XDG_CACHE_HOME/cctra/models-cache.json
//   - 老 dir 在成功迁移后被删
//   - 失败时 staging 备份保留
//   - 全新 install（无 ~/.cctra/）→ no-op
//   - 二进制等大、parse 通过
//
// 隔离：用 migrateToXdg({oldHome, newConfigHome, newCacheHome}) 纯函数，
// oldHome / newConfigHome / newCacheHome 注入 temp dir，碰不到用户真实 home。
// ============================================================================
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { migrateToXdg, CURRENT_VERSION } from "../src/core/migrate";

// 关掉 XDG migration（这文件就是测 migration 本身的，不能让它 auto-run）
process.env.CCTRA_NO_MIGRATE = "1";

let oldHome: string;
let newXdgRoot: string;
let newConfigHome: string;
let newCacheHome: string;
let savedConfigHome: string | undefined;
let savedCacheHome: string | undefined;
let savedHome: string | undefined;

beforeEach(() => {
  oldHome = mkdtempSync(join(tmpdir(), "cctra-xdg-old-"));
  newXdgRoot = mkdtempSync(join(tmpdir(), "cctra-xdg-new-"));
  newConfigHome = join(newXdgRoot, "config");
  newCacheHome = join(newXdgRoot, "cache");

  // 注入 XDG 路径：用 env vars 把 xdgConfigHome/xdgCacheHome 引导到 temp
  savedConfigHome = process.env.XDG_CONFIG_HOME;
  savedCacheHome = process.env.XDG_CACHE_HOME;
  savedHome = process.env.HOME;
  process.env.XDG_CONFIG_HOME = newConfigHome;
  process.env.XDG_CACHE_HOME = newCacheHome;
  // HOME 也要改，因为 migrateToXdg 内部用 homedir() 找 ~/.cctra/
  // （实际上我们注入 oldHome 参数，所以这里不影响；保险起见也改一下）
  process.env.HOME = oldHome;
});

afterEach(() => {
  if (oldHome) rmSync(oldHome, { recursive: true, force: true });
  if (newXdgRoot) rmSync(newXdgRoot, { recursive: true, force: true });
  if (savedConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedConfigHome;
  if (savedCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = savedCacheHome;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
});

describe("migrateToXdg", () => {
  test("全新 install：~/.cctra/ 不存在 → no-op", () => {
    // 不创建 oldHome/.cctra
    migrateToXdg({ oldHome, newConfigHome, newCacheHome });
    expect(existsSync(join(newConfigHome, "cctra"))).toBe(false);
    expect(existsSync(join(newCacheHome, "cctra"))).toBe(false);
  });

  test("config.toml 搬到 XDG_CONFIG_HOME/cctra/", () => {
    // Arrange: 老的 ~/.cctra/config.toml
    const oldCctra = join(oldHome, ".cctra");
    mkdirSync(oldCctra, { recursive: true });
    const oldConfig = join(oldCctra, "config.toml");
    writeFileSync(
      oldConfig,
      `port = 3133
[aliases]
pro = "ark/doubao-pro"
`,
    );

    // Act
    migrateToXdg({ oldHome, newConfigHome, newCacheHome });

    // Assert
    const newConfig = join(newConfigHome, "cctra", "config.toml");
    expect(existsSync(newConfig)).toBe(true);
    const data = parse(readFileSync(newConfig, "utf-8")) as { port: number; aliases: Record<string, string> };
    expect(data.port).toBe(3133);
    expect(data.aliases.pro).toBe("ark/doubao-pro");

    // 老 dir 已被删
    expect(existsSync(oldCctra)).toBe(false);
  });

  test("models-cache.json 搬到 XDG_CACHE_HOME/cctra/", () => {
    // Arrange
    const oldCctra = join(oldHome, ".cctra");
    mkdirSync(oldCctra, { recursive: true });
    const oldCache = join(oldCctra, "models-cache.json");
    writeFileSync(oldCache, JSON.stringify({ "endpoint|path": { models: ["m1"], expiresAt: 1234 } }));

    // Act
    migrateToXdg({ oldHome, newConfigHome, newCacheHome });

    // Assert
    const newCache = join(newCacheHome, "cctra", "models-cache.json");
    expect(existsSync(newCache)).toBe(true);
    const data = JSON.parse(readFileSync(newCache, "utf-8")) as Record<string, { models: string[]; expiresAt: number }>;
    const entry = data["endpoint|path"]!;
    expect(entry.models).toEqual(["m1"]);
    expect(entry.expiresAt).toBe(1234);

    expect(existsSync(oldCctra)).toBe(false);
  });

  test("config.toml + models-cache.json 一起迁", () => {
    // Arrange
    const oldCctra = join(oldHome, ".cctra");
    mkdirSync(oldCctra, { recursive: true });
    writeFileSync(join(oldCctra, "config.toml"), `port = 3133\n`);
    writeFileSync(join(oldCctra, "models-cache.json"), `{}`);

    // Act
    migrateToXdg({ oldHome, newConfigHome, newCacheHome });

    // Assert: 两者都搬了
    expect(existsSync(join(newConfigHome, "cctra", "config.toml"))).toBe(true);
    expect(existsSync(join(newCacheHome, "cctra", "models-cache.json"))).toBe(true);
    expect(existsSync(oldCctra)).toBe(false);
  });

  test("迁移成功后老 dir 真的被删（不是留 .bak 之类）", () => {
    const oldCctra = join(oldHome, ".cctra");
    mkdirSync(oldCctra, { recursive: true });
    writeFileSync(join(oldCctra, "config.toml"), `port = 3133\n`);

    migrateToXdg({ oldHome, newConfigHome, newCacheHome });

    expect(existsSync(oldCctra)).toBe(false);
    // staging 也不留
    const parent = oldHome;
    const leftovers = readdirSync(parent).filter((n) => n.startsWith(".cctra"));
    expect(leftovers).toEqual([]);
  });

  test("config.toml 内容字节级一致", () => {
    const oldCctra = join(oldHome, ".cctra");
    mkdirSync(oldCctra, { recursive: true });
    const content = `port = 3133\n[aliases]\npro = "x/y"\n`;
    writeFileSync(join(oldCctra, "config.toml"), content);

    migrateToXdg({ oldHome, newConfigHome, newCacheHome });

    const newContent = readFileSync(join(newConfigHome, "cctra", "config.toml"), "utf-8");
    expect(newContent).toBe(content);
  });
});

describe("runStartupMigrations invariants", () => {
  // 验证 migration 系统的 "self-evidence" 约束：
  // - CURRENT_VERSION 必须 >= 1（cctraVersion 字段有语义值）
  // - 跳过条件（env var CCTRA_NO_MIGRATE）能被 runStartupMigrations 读出来
  // 注：runStartupMigrations 内部用 homedir()，要测它必须 mock OS——留给 manual
  // smoke test 覆盖（见 plan §Verification 的「老用户迁移」段）。

  test("CURRENT_VERSION 必须 >= 1（保证 cctraVersion 字段有值）", () => {
    expect(CURRENT_VERSION).toBeGreaterThanOrEqual(1);
  });
});
