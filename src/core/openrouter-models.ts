// ============================================================================
// OpenRouter model list fetcher — 供 edit wizard 失败时显式 fallback 用
// 独立于 model-fetch.ts 的 L4 静默 fallback：角色不同（主查询 vs 兜底）、
// 超时不同（30s vs 5s）、前缀语义不同（provider/ vs org/）
// ============================================================================
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { modelsCachePath, ensureCctraDir } from "../utils/paths";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24h
const CACHE_KEY = "openrouter";
const TIMEOUT_MS = 30_000;

interface CacheEntry {
  models: string[];
  expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry>();

/**
 * 从 OpenRouter 拉取模型列表（独立缓存，24h TTL，30s timeout）
 * - 剥掉 `provider/` 前缀（OpenRouter 现网 id 格式是 provider/model）
 * - 过滤 `:free` 后缀
 */
export async function fetchOpenRouterModels(): Promise<string[]> {
  // L1: 内存
  const mem = memoryCache.get(CACHE_KEY);
  if (mem && mem.expiresAt > Date.now()) return mem.models;

  // L2: 磁盘
  ensureCctraDir();
  const cachePath = modelsCachePath();
  if (existsSync(cachePath)) {
    try {
      const disk = JSON.parse(readFileSync(cachePath, "utf-8")) as Record<string, CacheEntry>;
      const entry = disk[CACHE_KEY];
      if (entry && entry.expiresAt > Date.now()) {
        memoryCache.set(CACHE_KEY, entry);
        return entry.models;
      }
    } catch {
      // ignore disk cache error
    }
  }

  // L3: 网络
  let models: string[] = [];
  try {
    const res = await fetch(OPENROUTER_URL, {
      headers: { "User-Agent": "cctra" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const body = await res.json() as { data?: Array<{ id: string }> };
      models = sanitize(body.data ?? []);
    }
  } catch {
    // 网络/超时失败，返回空数组
  }

  // 回写缓存
  const entry: CacheEntry = { models, expiresAt: Date.now() + DEFAULT_TTL };
  memoryCache.set(CACHE_KEY, entry);
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    let disk: Record<string, CacheEntry> = {};
    if (existsSync(cachePath)) {
      disk = JSON.parse(readFileSync(cachePath, "utf-8")) as Record<string, CacheEntry>;
    }
    disk[CACHE_KEY] = entry;
    writeFileSync(cachePath, JSON.stringify(disk, null, 2), "utf-8");
  } catch {
    // ignore
  }
  return models;
}

/** 剥 provider/ 前缀，过滤 :free 后缀 */
function sanitize(models: Array<{ id: string }>): string[] {
  return models
    .map((m) => m.id)
    .filter((id) => !id.endsWith(":free"))
    .map((id) => {
      const idx = id.indexOf("/");
      return idx > 0 ? id.slice(idx + 1) : id;
    })
    .filter(Boolean);
}
