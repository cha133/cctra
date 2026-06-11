import type { Config, Source, Provider, PluginConfig, ApiFormat } from "../types";

/** 把 Provider 和 PluginConfig 都视为统一的 Source */
export function getAllSources(config: Config): Source[] {
  const providers = Object.values(config.providers);
  const plugins = Object.values(config.plugins).filter((p) => p.enabled);
  return [...providers, ...plugins];
}

export function getSource(config: Config, name: string): Source | null {
  return config.providers[name] ?? config.plugins[name] ?? null;
}

/** 判断 source 是不是 plugin */
export function isPlugin(s: Source): s is PluginConfig {
  return s.kind === "plugin";
}

/** 判断 source 是不是 provider */
export function isProvider(s: Source): s is Provider {
  return s.kind === "provider";
}

/** Source 的 API 格式（plugin 的格式由 plugin 实例决定，先用 openai-chat 占位） */
export function getApiFormat(s: Source): ApiFormat {
  if (isProvider(s)) return s.apiFormat;
  return "openai-chat"; // 插件默认；具体以插件 getConfig 返回的 UpstreamReady.apiFormat 为准
}
