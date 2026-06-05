import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseTOML, stringifyTOML } from "confbox";
import { configTomlPath, ensureCctraDir } from "../utils/paths";
import { DEFAULT_CONFIG, type Config, type Subscription, type PluginConfig, type Tier } from "../types";

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
    subscriptions: data.subscriptions ?? {},
    plugins: data.plugins ?? {},
    tiers: data.tiers ?? {},
  };

  // 补回 4 个预定义 tier（如果用户删了）
  for (const t of ["cctra", "cctra-pro", "cctra-flash", "cctra-vision"] as const) {
    if (!config.tiers[t]) {
      config.tiers[t] = {
        name: t,
        target: "",
        description: DEFAULT_CONFIG.tiers[t]?.description,
      };
    }
  }

  // 兜底：补 kind 字段（手动写的 config 可能漏了）
  for (const sub of Object.values(config.subscriptions)) {
    if (!sub.kind) sub.kind = "subscription";
  }
  for (const p of Object.values(config.plugins)) {
    if (!p.kind) p.kind = "plugin";
    if (p.enabled === undefined) p.enabled = true;
  }

  return config;
}

/** 把配置写到 ~/.cctra/config.toml */
export function saveConfigFile(config: Config): void {
  ensureCctraDir();
  const content = stringifyTOML(config as unknown as Record<string, unknown>);
  writeFileSync(configTomlPath(), content, "utf-8");
}

// ============================================================================
// Subscription CRUD
// ============================================================================

export function getAllSubscriptions(config: Config): Array<[string, Subscription]> {
  return Object.entries(config.subscriptions);
}

export function getSubscription(config: Config, name: string): Subscription | null {
  return config.subscriptions[name] ?? null;
}

export function addSubscription(config: Config, sub: Subscription): void {
  if (config.subscriptions[sub.name]) {
    throw new Error(`Subscription "${sub.name}" already exists.`);
  }
  config.subscriptions[sub.name] = sub;
}

export function updateSubscription(config: Config, sub: Subscription): void {
  if (!config.subscriptions[sub.name]) {
    throw new Error(`Subscription "${sub.name}" not found.`);
  }
  config.subscriptions[sub.name] = sub;
}

export function removeSubscription(config: Config, name: string): void {
  if (!config.subscriptions[name]) {
    throw new Error(`Subscription "${name}" not found.`);
  }
  delete config.subscriptions[name];
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

// ============================================================================
// Tier CRUD
// ============================================================================

export function getAllTiers(config: Config): Array<[string, Tier]> {
  return Object.entries(config.tiers);
}

export function getTier(config: Config, name: string): Tier | null {
  return config.tiers[name] ?? null;
}

export function setTier(config: Config, tier: Tier): void {
  config.tiers[tier.name] = tier;
}

export function removeTier(config: Config, name: string): void {
  // 预定义 tier 不允许删除，只能清空 target
  if (["cctra", "cctra-pro", "cctra-flash", "cctra-vision"].includes(name)) {
    config.tiers[name] = {
      name,
      target: "",
      description: DEFAULT_CONFIG.tiers[name]?.description,
    };
    return;
  }
  delete config.tiers[name];
}
