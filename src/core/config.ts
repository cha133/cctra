import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseTOML, stringifyTOML } from "confbox";
import { configTomlPath, ensureCctraDir } from "../utils/paths";
import {
  DEFAULT_CONFIG,
  buildDefaultAliases,
  type Config,
  type Provider,
  type PluginConfig,
} from "../types";

/**
 * 从 ~/.cctra/config.toml 加载配置
 * 如果文件不存在或损坏，返回默认配置
 */
export function loadConfigFile(): Config {
  const path = configTomlPath();
  if (!existsSync(path)) {
    return structuredClone(DEFAULT_CONFIG);
  }

  const content = readFileSync(path, "utf-8");
  let data: Partial<Config>;
  try {
    data = parseTOML(content) as Partial<Config>;
  } catch {
    console.warn("⚠ ~/.cctra/config.toml 格式损坏，将按空配置处理");
    return structuredClone(DEFAULT_CONFIG);
  }

  // 合并默认结构
  const config: Config = {
    port: data.port ?? DEFAULT_CONFIG.port,
    providers: data.providers ?? {},
    plugins: data.plugins ?? {},
    aliases:
      data.aliases && typeof data.aliases === "object" && !Array.isArray(data.aliases)
        ? (data.aliases as Record<string, string>)
        : buildDefaultAliases(),
  };

  // 兜底：补 kind 字段（手动写的 config 可能漏了）
  for (const provider of Object.values(config.providers)) {
    if (!provider.kind) provider.kind = "provider";
  }
  for (const p of Object.values(config.plugins)) {
    if (!p.kind) p.kind = "plugin";
    if (p.enabled === undefined) p.enabled = true;
  }

  // 老 config 兼容：把 Model.alias 字段搬到 config.aliases 表
  migrateLegacyAliases(config);

  return config;
}

/**
 * 把 Model.alias 字段迁移到 config.aliases 表。
 *
 * - 不覆盖用户已写的同名 alias
 * - 删除 Model 上的 alias 字段（下次 save 自然落盘清掉）
 * - 幂等：再跑一次空操作
 */
function migrateLegacyAliases(config: Config): void {
  for (const [pname, provider] of Object.entries(config.providers)) {
    if (!provider.models) provider.models = [];
    for (const m of provider.models) {
      const legacy = (m as unknown as { alias?: string }).alias;
      if (legacy && config.aliases[legacy] === undefined) {
        config.aliases[legacy] = `${pname}/${m.id}`;
      }
      delete (m as unknown as { alias?: string }).alias;
    }
  }
  for (const [pname, plugin] of Object.entries(config.plugins)) {
    if (!plugin.models) plugin.models = [];
    for (const m of plugin.models) {
      const legacy = (m as unknown as { alias?: string }).alias;
      if (legacy && config.aliases[legacy] === undefined) {
        config.aliases[legacy] = `${pname}/${m.id}`;
      }
      delete (m as unknown as { alias?: string }).alias;
    }
  }
}

/** 把配置写到 ~/.cctra/config.toml */
export function saveConfigFile(config: Config): void {
  ensureCctraDir();
  const content = stringifyTOML(config as unknown as Record<string, unknown>);
  writeFileSync(configTomlPath(), content, "utf-8");
}

// ============================================================================
// Provider CRUD
// ============================================================================

export function getAllProviders(config: Config): Array<[string, Provider]> {
  return Object.entries(config.providers);
}

export function getProvider(config: Config, name: string): Provider | null {
  return config.providers[name] ?? null;
}

export function addProvider(config: Config, provider: Provider): void {
  if (config.providers[provider.name]) {
    throw new Error(`Provider "${provider.name}" already exists.`);
  }
  config.providers[provider.name] = provider;
}

export function updateProvider(config: Config, provider: Provider): void {
  if (!config.providers[provider.name]) {
    throw new Error(`Provider "${provider.name}" not found.`);
  }
  config.providers[provider.name] = provider;
}

export function removeProvider(config: Config, name: string): void {
  if (!config.providers[name]) {
    throw new Error(`Provider "${name}" not found.`);
  }
  delete config.providers[name];
}

// ============================================================================
// Plugin CRUD
// ============================================================================

export function getAllPlugins(config: Config): Array<[string, PluginConfig]> {
  return Object.entries(config.plugins);
}

export function getPlugin(config: Config, name: string): PluginConfig | null {
  return config.plugins[name] ?? null;
}

export function addPlugin(config: Config, plugin: PluginConfig): void {
  if (config.plugins[plugin.name]) {
    throw new Error(`Plugin "${plugin.name}" already exists.`);
  }
  config.plugins[plugin.name] = plugin;
}

export function updatePlugin(config: Config, plugin: PluginConfig): void {
  if (!config.plugins[plugin.name]) {
    throw new Error(`Plugin "${plugin.name}" not found.`);
  }
  config.plugins[plugin.name] = plugin;
}

export function removePlugin(config: Config, name: string): void {
  if (!config.plugins[name]) {
    throw new Error(`Plugin "${name}" not found.`);
  }
  delete config.plugins[name];
}
