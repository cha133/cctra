// 占位：从上游拉模型列表（带 3 层缓存：内存 → 磁盘 → 网络）
// 完整实现会照搬 ccswi/src/models/api.ts 的 getAllModelNames 逻辑
// v1 先用空实现，CLI add 时手动填模型 ID 也行
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { modelsCachePath, ensureCctraDir } from "../utils/paths";
import type { ApiFormat } from "../types";

export interface FetchModelsOptions {
  endpoint: string;
  token: string;
  apiFormat: ApiFormat;
  modelsPath?: string;       // 默认 "/v1/models"
  ttlMs?: number;            // 默认 24h
}

interface ModelCacheEntry {
  models: string[];
  expiresAt: number;
}

const memoryCache = new Map<string, ModelCacheEntry>();

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24h
const OPENROUTER_FALLBACK = "https://openrouter.ai/api/v1/models";

// 已知的 Anthropic 兼容路径后缀（按长度降序，先匹配长后缀）
// 供应商的 endpoint 可能指向 Anthropic 兼容子路径（如 /anthropic），
// 但 /v1/models 通常只在根路径可用，需要剥离子路径后重试
const KNOWN_COMPAT_SUFFIXES = [
  "/api/claudecode",
  "/api/anthropic",
  "/apps/anthropic",
  "/api/coding",
  "/api/plan",
  "/claudecode",
  "/anthropic",
  "/step_plan",
  "/coding",
  "/claude",
];

export function stripCompatSuffix(url: string): string | null {
  const trimmed = url.replace(/\/+$/, "");
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (trimmed.endsWith(suffix)) {
      return trimmed.slice(0, trimmed.length - suffix.length);
    }
  }
  return null;
}

/**
 * cctra test 探测用：如果 URL 末尾是已知 probe 路径之一，剥掉它，暴露出 "真" baseURL。
 * 让用户直接粘完整 endpoint URL 也能跑通。
 *
 *   stripProbePath("http://localhost/v1/messages")            -> "http://localhost"
 *   stripProbePath("http://localhost/anthropic/v1/messages")  -> "http://localhost"
 *   stripProbePath("http://localhost/anthropic")             -> "http://localhost"
 *   stripProbePath("http://localhost/v1/chat/completions")   -> "http://localhost"
 *   stripProbePath("http://localhost/v1/responses")          -> "http://localhost"
 *   stripProbePath("http://localhost/v1")                    -> "http://localhost"   (covers old stripV1)
 *   stripProbePath("http://localhost")                       -> "http://localhost"   (no-op)
 */
const PROBE_PATHS = [
  "/anthropic/v1/messages",   // 23 chars — longest first，避免被 /v1/messages 误截
  "/v1/chat/completions",     // 21
  "/v1/responses",            // 13
  "/v1/messages",             // 12
  "/v1",                      // 3
  "/anthropic",               // 10
];

export function stripProbePath(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  // 长路径优先匹配
  for (const path of [...PROBE_PATHS].sort((a, b) => b.length - a.length)) {
    if (trimmed.endsWith(path)) {
      return trimmed.slice(0, trimmed.length - path.length);
    }
  }
  return trimmed;
}

/**
 * 从上游拉模型列表（带 3 层缓存 + OpenRouter fallback）
 * 1. 试上游 endpoint 的 /v1/models
 * 2. 失败 → fallback 到 OpenRouter（去 :free 后缀 + 去 provider 前缀）
 * 3. 网络都失败 → 返回空数组（add wizard 会用手动输入 fallback）
 */
export async function fetchUpstreamModels(opts: FetchModelsOptions): Promise<string[]> {
  const ttl = opts.ttlMs ?? DEFAULT_TTL;
  const path = opts.modelsPath ?? "/v1/models";
  const key = `${opts.endpoint}|${path}`;

  // L1: 内存
  const mem = memoryCache.get(key);
  if (mem && mem.expiresAt > Date.now()) return mem.models;

  // L2: 磁盘
  ensureCctraDir();
  const cachePath = modelsCachePath();
  if (existsSync(cachePath)) {
    try {
      const disk = JSON.parse(readFileSync(cachePath, "utf-8")) as Record<string, ModelCacheEntry>;
      const entry = disk[key];
      if (entry && entry.expiresAt > Date.now()) {
        memoryCache.set(key, entry);
        return entry.models;
      }
    } catch {
      // ignore disk cache error
    }
  }

  // L3: 网络 — 先试上游
  const url = joinUrl(opts.endpoint, path);
  const headers: Record<string, string> = {};
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  let models = await tryFetchModels(url, headers);

  // L3.5: 剥离已知兼容路径后缀后重试（如 /anthropic → 根 /v1/models）
  if (models.length === 0) {
    const stripped = stripCompatSuffix(opts.endpoint);
    if (stripped) {
      const fallbackUrl = joinUrl(stripped, path);
      if (fallbackUrl !== url) {
        models = await tryFetchModels(fallbackUrl, headers);
      }
    }
  }

  // L4: Fallback 到 OpenRouter
  if (models.length === 0) {
    const fallback = await tryFetchModels(OPENROUTER_FALLBACK, {});
    models = sanitizeOpenRouterModels(fallback);
  }

  // 回写缓存
  const entry: ModelCacheEntry = { models, expiresAt: Date.now() + ttl };
  memoryCache.set(key, entry);
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    let disk: Record<string, ModelCacheEntry> = {};
    if (existsSync(cachePath)) {
      disk = JSON.parse(readFileSync(cachePath, "utf-8")) as Record<string, ModelCacheEntry>;
    }
    disk[key] = entry;
    writeFileSync(cachePath, JSON.stringify(disk, null, 2), "utf-8");
  } catch {
    // ignore
  }
  return models;
}

/**
 * 拉单个端点的 models（无 auth header 因为 OpenRouter fallback 不带 token）
 */
async function tryFetchModels(url: string, headers: Record<string, string>): Promise<string[]> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const body = await res.json() as { data?: Array<{ id: string }> };
      return (body.data ?? []).map((m) => m.id);
    }
  } catch {
    // 网络/超时失败
  }
  return [];
}

/**
 * 清理 OpenRouter 返回的模型名（抄 ccswi 规则）
 * - 去掉 :free 后缀
 * - 去掉 provider 前缀（org/model → model）
 */
function sanitizeOpenRouterModels(models: string[]): string[] {
  return models.flatMap((id) => {
    if (id.endsWith(":free")) return [];
    const slashIdx = id.indexOf("/");
    return slashIdx > 0 ? [id.slice(slashIdx + 1)] : [id];
  });
}

export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  // 避免 /v1/v1 重复
  if (b.endsWith("/v1") && p.startsWith("/v1/")) return `${b}${p.slice(3)}`;
  if (b.endsWith("/v1beta") && p.startsWith("/v1beta/")) return `${b}${p.slice(7)}`;
  return `${b}${p}`;
}
