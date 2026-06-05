// ============================================================================
// cctra 给插件的 host API 工厂
// ============================================================================
import type { PluginContext } from "./contract";
import { logger } from "../utils/logger";

const cache = new Map<string, { value: unknown; expiresAt: number }>();

export function makePluginContext(pluginName: string, config: Record<string, unknown>): PluginContext {
  return {
    config,
    logger: (msg: string) => logger.info(`[plugin:${pluginName}] ${msg}`),
    fetch: fetch.bind(globalThis),
    cacheGet: async (key: string) => {
      const entry = cache.get(`${pluginName}:${key}`);
      if (!entry) return undefined;
      if (entry.expiresAt < Date.now()) {
        cache.delete(`${pluginName}:${key}`);
        return undefined;
      }
      return entry.value;
    },
    cacheSet: async (key: string, value: unknown, ttlMs = 60_000) => {
      cache.set(`${pluginName}:${key}`, { value, expiresAt: Date.now() + ttlMs });
    },
  };
}
