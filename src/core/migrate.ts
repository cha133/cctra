// ============================================================================
// cctra schema/layout migrations
// ----------------------------------------------------------------------------
// 每次 layout 改变加一个 entry 进 MIGRATIONS 数组。runStartupMigrations() 检查
// 是否有 pending migration（通过探测老 ~/.cctra/ + 读 XDG config 的 cctraVersion），
// 跑了之后写 cctraVersion = CURRENT_VERSION 到新 XDG config。
//
// 跟 package.json version 无关——是 schema/layout 的 version。保留 3 个 cctra
// 版本后（v0.11.0+）可删除本文件 + Config.cctraVersion 字段 + 调用点 + CCTRA_NO_MIGRATE。
// ============================================================================
import {
  existsSync,
  renameSync,
  rmSync,
  statSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseTOML, stringifyTOML } from "confbox";
import { xdgConfigHome, xdgCacheHome } from "../utils/xdg";
import { configTomlPath, ensureCctraDir } from "../utils/paths";

/** 当前最大支持的 schema version。新 migration 加在 MIGRATIONS 末尾。 */
export const CURRENT_VERSION = 1;

interface Migration {
  version: number;
  /** file-moving / external-state migration */
  run: () => void;
}

/**
 * Pending migrations。runStartupMigrations() 按 version 顺序跑。
 *
 * v0.8.0 首次启用 migrateToXdg（从 ~/.cctra/ 搬到 XDG root）。3 个版本后（v0.11.0+）
 * 删除整个 MIGRATIONS 数组 + 当前条目 + runStartupMigrations 调用 + CCTRA_NO_MIGRATE env var。
 */
const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    run: () =>
      migrateToXdg({
        oldHome: homedir(),
        newConfigHome: xdgConfigHome(),
        newCacheHome: xdgCacheHome(),
      }),
  },
] as const;

/**
 * 在 cctra 启动早期跑一次（loadConfigFile 头部调）。幂等。
 *
 * 跳过条件：CCTRA_CONFIG 设置（test 隔离）/ CCTRA_NO_MIGRATE=1 / 没有任何 pending migration。
 */
export function runStartupMigrations(): void {
  if (shouldSkip()) return;
  const configPath = configTomlPath();
  const current = readCctraVersionFromDisk(configPath);
  const target = CURRENT_VERSION;
  if (current >= target) return;

  for (const m of MIGRATIONS) {
    if (current < m.version) {
      try {
        m.run();
      } catch (e) {
        console.error(`⚠ cctra migration to schema v${m.version} failed: ${(e as Error).message}`);
        return; // 不 bump，下次启动再试
      }
    }
  }
  // 跑成功才 bump version
  bumpCctraVersionOnDisk(configPath, target);
}

function shouldSkip(): boolean {
  if (process.env.CCTRA_CONFIG) return true; // test 隔离
  if (process.env.CCTRA_NO_MIGRATE === "1") return true;
  return false;
}

function readCctraVersionFromDisk(configPath: string): number {
  if (!existsSync(configPath)) return 0;
  try {
    const data = parseTOML(readFileSync(configPath, "utf-8")) as { cctraVersion?: number };
    return data.cctraVersion ?? 0;
  } catch {
    return 0;
  }
}

function bumpCctraVersionOnDisk(configPath: string, version: number): void {
  // 全新 install 还无 config 文件：等首次 saveConfigFile 时再带 cctraVersion
  if (!existsSync(configPath)) return;
  let data: Record<string, unknown>;
  try {
    data = parseTOML(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch {
    return; // 解析失败不致命，下个 save 覆盖
  }
  data.cctraVersion = version;
  ensureCctraDir();
  const tmp = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, stringifyTOML(data), "utf-8");
  renameSync(tmp, configPath);
}

/**
 * 暴露的纯函数版本（paths 注入）——测试用。
 * 生产环境走 runStartupMigrations() 间接调用。
 */
export function migrateToXdg(params: {
  oldHome: string;
  newConfigHome: string;
  newCacheHome: string;
}): void {
  const { oldHome, newConfigHome, newCacheHome } = params;
  const old = join(oldHome, ".cctra");
  if (!existsSync(old)) return; // 全新安装，无事可做

  // Staging rename：原子（同一 volume），失败时老 dir 不变可重试
  const staging = `${old}.migrating-${process.pid}-${Date.now()}`;
  try {
    renameSync(old, staging);
  } catch (e) {
    throw new Error(`failed to rename ${old} → staging: ${(e as Error).message}`);
  }

  try {
    // config.toml
    const oldConfig = join(staging, "config.toml");
    if (existsSync(oldConfig)) {
      const newDir = join(newConfigHome, "cctra");
      mkdirSync(newDir, { recursive: true });
      copyFileSync(oldConfig, join(newDir, "config.toml"));
      assertCopyMatches(oldConfig, join(newDir, "config.toml"));
      try {
        parseTOML(readFileSync(join(newDir, "config.toml"), "utf-8"));
      } catch (e) {
        throw new Error(`migrated config.toml is not valid TOML: ${(e as Error).message}`);
      }
    }

    // models-cache.json
    const oldCache = join(staging, "models-cache.json");
    if (existsSync(oldCache)) {
      const newDir = join(newCacheHome, "cctra");
      mkdirSync(newDir, { recursive: true });
      copyFileSync(oldCache, join(newDir, "models-cache.json"));
      assertCopyMatches(oldCache, join(newDir, "models-cache.json"));
      try {
        JSON.parse(readFileSync(join(newDir, "models-cache.json"), "utf-8"));
      } catch (e) {
        throw new Error(`migrated models-cache.json is not valid JSON: ${(e as Error).message}`);
      }
    }

    // 全部成功才删 staging
    rmSync(staging, { recursive: true, force: true });
    console.log(`✓ cctra: migrated ~/.cctra/ → XDG layout`);
  } catch (e) {
    console.error(`⚠ cctra XDG migration failed: ${(e as Error).message}`);
    console.error(`  staging copy preserved at ${staging} for manual recovery`);
    console.error(`  to retry: rm -rf ~/.cctra && mv '${staging}' ~/.cctra && restart cctra`);
    // 把 staging 留作 rollback；不 re-throw，让 CLI 继续用空 config 跑
  }
}

function assertCopyMatches(src: string, dst: string): void {
  const s1 = statSync(src).size;
  const s2 = statSync(dst).size;
  if (s1 !== s2) {
    throw new Error(`size mismatch after copy: ${src} (${s1}B) vs ${dst} (${s2}B)`);
  }
}
