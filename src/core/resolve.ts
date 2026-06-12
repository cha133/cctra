import type { Config, Source } from "../types";
import { getSource } from "./source";

/**
 * 解析模型引用字符串，返回 (Source, upstreamModelId)
 *
 * 解析优先级：
 *   1. config.aliases[ref] 命中 → 递归 resolve 其 value（一层）
 *   2. "provider/model" / "plugin/model"（按第一个 / 拆分；在该 source 内按 m.id 找）
 *   3. 都不匹配 → null
 */
export function resolveModelRef(
  ref: string,
  config: Config,
): { source: Source; modelId: string } | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;

  // 1. alias 表
  if (config.aliases[trimmed] !== undefined) {
    return resolveAlias(trimmed, config, new Set());
  }

  // 2. "provider/model" 格式
  if (trimmed.includes("/")) {
    const [sourceName, modelPart] = trimmed.split("/", 2);
    if (!sourceName || !modelPart) return null;
    const source = getSource(config, sourceName);
    if (!source) return null;
    const model = source.models.find((m) => m.id === modelPart);
    if (!model) return null;
    return { source, modelId: model.id };
  }

  return null;
}

/**
 * 沿 alias 链解析到具体 model；理论上 value 只能是 "provider/model" 形态
 * （cctra alias / cctra switch 写入时都 normalize 成全名），不会构成多跳链；
 * 但保留 visited 防御性环检测（损坏 config / 用户手编 toml 时）。
 */
function resolveAlias(
  name: string,
  config: Config,
  visited: Set<string>,
): { source: Source; modelId: string } {
  if (visited.has(name)) {
    throw new ResolveError(
      `Alias cycle detected: ${[...visited, name].join(" -> ")}.`,
    );
  }
  visited.add(name);

  const value = config.aliases[name];
  if (value === undefined) {
    // 不应该走到这里（调用方已经 isAliasName 检查过），但兜底
    throw new ResolveError(`Alias "${name}" not found.`);
  }
  if (value === "") {
    throw new ResolveError(
      `Alias "${name}" is unbound. Use \`cctra switch ${name} <provider>/<model>\` to bind.`,
    );
  }
  if (!value.includes("/")) {
    throw new ResolveError(
      `Alias "${name}" has invalid value "${value}". Expected "provider/model" or empty.`,
    );
  }

  const [src, mp] = value.split("/", 2);
  if (!src || !mp) {
    throw new ResolveError(
      `Alias "${name}" has invalid value "${value}". Expected "provider/model".`,
    );
  }

  const srcObj = getSource(config, src);
  if (!srcObj) {
    throw new ResolveError(
      `Alias "${name}" points to unknown source "${src}". Use \`cctra switch ${name}\` to rebind.`,
    );
  }
  const model = srcObj.models.find((m) => m.id === mp);
  if (!model) {
    throw new ResolveError(
      `Alias "${name}" points to missing model "${value}". Use \`cctra switch ${name}\` to rebind.`,
    );
  }
  return { source: srcObj, modelId: model.id };
}

/** 解析错误（用 throw 表达歧义或不存在） */
export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolveError";
  }
}
