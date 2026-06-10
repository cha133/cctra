import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

/** ~/.cctra 目录路径 */
export function cctraDir(): string {
  return join(homedir(), ".cctra");
}

/**
 * ~/.cctra/config.toml 路径
 * 优先级：CCTRA_CONFIG 环境变量 > ~/.cctra/config.toml
 * （测试通过 CCTRA_CONFIG 指向临时目录，隔离真实 config）
 */
export function configTomlPath(): string {
  if (process.env.CCTRA_CONFIG) return process.env.CCTRA_CONFIG;
  return join(cctraDir(), "config.toml");
}

/** ~/.cctra/models-cache.json 路径 */
export function modelsCachePath(): string {
  return join(cctraDir(), "models-cache.json");
}

/** ~/.cctra/plugins/<name>/ 目录 */
export function pluginDir(name: string): string {
  return join(cctraDir(), "plugins", name);
}

/** ~/.cctra/plugins/<name>/config.json 路径 */
export function pluginConfigPath(name: string): string {
  return join(pluginDir(name), "config.json");
}

/** 确保目录存在 */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** 确保 cctra 目录存在 */
export function ensureCctraDir(): void {
  // 测试用 CCTRA_CONFIG 指向其他目录时，也确保那个父目录存在
  if (process.env.CCTRA_CONFIG) {
    ensureDir(dirname(process.env.CCTRA_CONFIG));
    return;
  }
  ensureDir(cctraDir());
}
