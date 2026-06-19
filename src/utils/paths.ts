import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { xdgConfigHome, xdgCacheHome } from "./xdg";

/**
 * Test 隔离的根目录。如果 CCTRA_CONFIG 设置了，所有数据（config、cache、state）都派生自
 * dirname(CCTRA_CONFIG)——即「CCTRA_CONFIG 指向哪，整个 data dir 就被 redirect 到哪」。
 * 没设置时按 XDG 根目录拼。
 *
 * 注：cctra v0.7.x 之前只有 config.toml 被 CCTRA_CONFIG redirect，models-cache 和 serve.pid
 * 仍走真实 ~/.cctra/——是一个 latent bug。v0.8.0 统一修。
 */
function dataRoot(): string {
  if (process.env.CCTRA_CONFIG) return dirname(process.env.CCTRA_CONFIG);
  return xdgConfigHome();
}

/**
 * ~/.config/cctra/config.toml 路径
 * 优先级：CCTRA_CONFIG 环境变量 > ~/.config/cctra/config.toml
 * （测试通过 CCTRA_CONFIG 指向临时目录，隔离真实 config）
 */
export function configTomlPath(): string {
  if (process.env.CCTRA_CONFIG) return process.env.CCTRA_CONFIG;
  return join(xdgConfigHome(), "cctra", "config.toml");
}

/** ~/.cache/cctra/models-cache.json 路径 */
export function modelsCachePath(): string {
  // 跟 config 一起 redirect：test fixture 用 CCTRA_CONFIG=tempDir/config.toml 就能隔离 cache
  if (process.env.CCTRA_CONFIG) return join(dataRoot(), "models-cache.json");
  return join(xdgCacheHome(), "cctra", "models-cache.json");
}

/** ~/.config/cctra/plugins/<name>/ 目录（v1 dead code，留着对齐新 layout） */
export function pluginDir(name: string): string {
  return join(xdgConfigHome(), "cctra", "plugins", name);
}

/** ~/.config/cctra/plugins/<name>/config.json 路径 */
export function pluginConfigPath(name: string): string {
  return join(pluginDir(name), "config.json");
}

/** 确保目录存在 */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** 确保 cctra data 根目录存在（config 所在 dir） */
export function ensureCctraDir(): void {
  if (process.env.CCTRA_CONFIG) {
    ensureDir(dirname(process.env.CCTRA_CONFIG));
    return;
  }
  ensureDir(join(xdgConfigHome(), "cctra"));
}
