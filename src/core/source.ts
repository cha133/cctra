import type { Config, Source, Subscription, PluginConfig, ApiFormat } from "../types";

/** 把 Subscription 和 PluginConfig 都视为统一的 Source */
export function getAllSources(config: Config): Source[] {
  const subs = Object.values(config.subscriptions);
  const plugins = Object.values(config.plugins).filter((p) => p.enabled);
  return [...subs, ...plugins];
}

export function getSource(config: Config, name: string): Source | null {
  return config.subscriptions[name] ?? config.plugins[name] ?? null;
}

/** 判断 source 是不是 plugin */
export function isPlugin(s: Source): s is PluginConfig {
  return s.kind === "plugin";
}

/** 判断 source 是不是 subscription */
export function isSubscription(s: Source): s is Subscription {
  return s.kind === "subscription";
}

/** Source 的 API 格式（plugin 的格式由 plugin 实例决定，先用 openai-chat 占位） */
export function getApiFormat(s: Source): ApiFormat {
  if (isSubscription(s)) return s.apiFormat;
  return "openai-chat"; // 插件默认；具体以插件 getConfig 返回的 UpstreamReady.apiFormat 为准
}
