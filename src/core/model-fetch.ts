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

/**
 * 从上游拉模型列表（带 3 层缓存）
 * v1 简化版：只支持 OpenAI 兼容的 /v1/models 端点
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

  // L3: 网络
  let models: string[] = [];
  try {
    const url = joinUrl(opts.endpoint, path);
    const headers: Record<string, string> = {};
    if (opts.apiFormat === "openai-chat" || opts.apiFormat === "anthropic-messages") {
      if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const body = await res.json() as { data?: Array<{ id: string }> };
      models = (body.data ?? []).map((m) => m.id);
    }
  } catch {
    // 网络失败：返回空数组
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

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  // 避免 /v1/v1 重复
  if (b.endsWith("/v1") && p.startsWith("/v1/")) return `${b}${p.slice(3)}`;
  if (b.endsWith("/v1beta") && p.startsWith("/v1beta/")) return `${b}${p.slice(7)}`;
  return `${b}${p}`;
}
