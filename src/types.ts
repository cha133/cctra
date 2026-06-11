// ============================================================================
// Source 抽象：所有提供模型的服务（静态 provider + 动态插件）的统一接口
// ============================================================================

import type { ApiFormat } from "./canonical/types";

export type SourceKind = "provider" | "plugin";

export interface Source {
  kind: SourceKind;
  name: string;
  displayName?: string;
  models: Model[];
}

// ============================================================================
// Model：模型元数据
// ============================================================================

export interface Model {
  id: string;
  alias?: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
}

// ============================================================================
// Provider：静态上游提供方（endpoint + token + 协议类型）
// ============================================================================

export type { ApiFormat } from "./canonical/types";

export interface Provider extends Source {
  kind: "provider";
  vendor?: string;                // 来源 vendor 名（仅显示用，不影响路由）
  endpoint: string;
  token: string;
  apiFormat: ApiFormat;
  chatCompletionsPath?: string;        // 默认 "/v1/chat/completions"（仅 openai-chat）
  messagesPath?: string;               // 默认 "/v1/messages"（仅 anthropic）
  responsesPath?: string;              // 默认 "/v1/responses"（仅 openai-responses）
  modelsPath?: string;                 // 默认 "/v1/models"
  headers?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Plugin：本地路径插件配置
// ============================================================================

export interface PluginConfig extends Source {
  kind: "plugin";
  path: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

// ============================================================================
// 总配置（~/.cctra/config.toml 的 schema）
// ============================================================================

export interface Config {
  port: number;
  providers: Record<string, Provider>;
  plugins: Record<string, PluginConfig>;
}

export const DEFAULT_CONFIG: Config = {
  port: 3133,
  providers: {},
  plugins: {},
};
