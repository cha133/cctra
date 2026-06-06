// ============================================================================
// 插件加载器：动态 import() 用户的 .js 文件，缓存到内存
// v1 是 trust 模型：插件 = 任意 JS，可执行任何代码
// ============================================================================
import { statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginConfig, Config } from "../types";
import type { UpstreamPlugin } from "./contract";
import { info, error as errorOut } from "../ui/format";

const moduleCache = new Map<string, UpstreamPlugin>();

/** 加载并缓存插件。CLI 一次性操作，输出走 format（stdout/stderr）给用户看。 */
export async function loadPlugin(plugin: PluginConfig, _config: Config): Promise<UpstreamPlugin | null> {
  if (moduleCache.has(plugin.path)) {
    return moduleCache.get(plugin.path)!;
  }

  // 验证文件存在
  try {
    statSync(plugin.path);
  } catch {
    errorOut(`[plugin:${plugin.name}] file not found: ${plugin.path}`);
    return null;
  }

  // 用 cache-busting query string 避免 stale cache
  const url = pathToFileURL(resolvePath(plugin.path)).href;
  const cacheBustUrl = `${url}?t=${Date.now()}`;

  try {
    const mod = await import(cacheBustUrl);
    const instance: UpstreamPlugin = mod.default ?? mod;
    if (!instance.name) {
      instance.name = plugin.name;
    }
    moduleCache.set(plugin.path, instance);
    info(`[plugin:${plugin.name}] loaded from ${plugin.path}`);
    return instance;
  } catch (e) {
    errorOut(`[plugin:${plugin.name}] failed to import: ${(e as Error).message}`);
    return null;
  }
}

/** 清空缓存（用户在 CLI 里 disable 插件时调用） */
export function unloadPlugin(path: string): void {
  moduleCache.delete(path);
}

/** 清空所有缓存（daemon 重新加载配置时用） */
export function clearPluginCache(): void {
  moduleCache.clear();
}
