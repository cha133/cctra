import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";

/** ~/.cctra 目录路径 */
export function cctraDir(): string {
  return join(homedir(), ".cctra");
}

/** ~/.cctra/config.toml 路径 */
export function configTomlPath(): string {
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
  ensureDir(cctraDir());
}
