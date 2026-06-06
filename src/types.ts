// ============================================================================
// Source 抽象：所有提供模型的服务（静态订阅 + 动态插件）的统一接口
// ============================================================================

export type SourceKind = "subscription" | "plugin";

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
// Subscription：静态订阅（endpoint + token + 协议类型）
// ============================================================================

export type ApiFormat = "openai-chat" | "openai-responses" | "anthropic-messages";

export interface Subscription extends Source {
  kind: "subscription";
  endpoint: string;
  token: string;
  apiFormat: ApiFormat;
  chatCompletionsPath?: string;        // 默认 "/v1/chat/completions"（仅 openai-chat）
  messagesPath?: string;               // 默认 "/v1/messages"（仅 anthropic）
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
// Tier：层级模型别名（用户固定写 cctra-pro，cctra 动态路由到具体模型）
// ============================================================================

export interface Tier {
  name: string;
  target: string;                       // "subscription/model" 或 "plugin/model"
  description?: string;
}

export const BUILTIN_TIERS = ["cctra", "cctra-pro", "cctra-flash", "cctra-vision"] as const;
export type BuiltinTier = typeof BUILTIN_TIERS[number];

// ============================================================================
// 总配置（~/.cctra/config.toml 的 schema）
// ============================================================================

export interface Config {
  port: number;
  subscriptions: Record<string, Subscription>;
  plugins: Record<string, PluginConfig>;
  tiers: Record<string, Tier>;
}

export const DEFAULT_CONFIG: Config = {
  port: 3133,
  subscriptions: {},
  plugins: {},
  tiers: {
    cctra: { name: "cctra", target: "", description: "默认（中等质量、便宜）" },
    "cctra-pro": { name: "cctra-pro", target: "", description: "深度思考（慢但强）" },
    "cctra-flash": { name: "cctra-flash", target: "", description: "高速（小快灵）" },
    "cctra-vision": { name: "cctra-vision", target: "", description: "多模态" },
  },
};
