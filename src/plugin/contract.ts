// ============================================================================
// 插件契约：给插件作者用的 .d.ts 类型
// ============================================================================
import type { ApiFormat } from "../types";
import type { CanonicalRequest, CanonicalResponse, CanonicalChunk } from "../canonical/types";

/** 插件作者导出的对象 */
export interface UpstreamPlugin {
  /** 全局唯一名 */
  name: string;
  displayName?: string;

  /** 声明式模式：返回 ready config，让 cctra 帮你发请求 */
  getConfig?(ctx: PluginContext): Promise<UpstreamReady | UpstreamReady[]>;

  /** 函数式模式：直接接管请求（更灵活） */
  fetch?(req: CanonicalRequest, ctx: PluginContext): Promise<CanonicalResponse>;
  fetchStream?(req: CanonicalRequest, ctx: PluginContext): AsyncIterable<CanonicalChunk>;

  /** 可选：返回插件能服务的模型列表 */
  listModels?(ctx: PluginContext): Promise<PluginModel[]>;
}

/** 一次 getConfig 调用返回的"准备好"配置 */
export interface UpstreamReady {
  baseUrl: string;
  path: string;
  apiFormat: ApiFormat;
  authHeader: Record<string, string>;
  modelId: string;
  modelMetadata?: PluginModel;
}

/** cctra 给插件的 API */
export interface PluginContext {
  /** 用户填的插件配置（JSON） */
  config: Record<string, unknown>;
  /** 写日志（带插件名前缀） */
  logger: (msg: string) => void;
  /** cctra 的 fetch 包装 */
  fetch: typeof fetch;
  /** 内存缓存 */
  cacheGet: (key: string) => Promise<unknown | undefined>;
  cacheSet: (key: string, value: unknown, ttlMs?: number) => Promise<void>;
}

export interface PluginModel {
  id: string;
  alias?: string;
  metadata?: Record<string, unknown>;
}
