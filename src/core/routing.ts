import type { Config, Source, ApiFormat } from "../types";
import { resolveModelRef, ResolveError } from "./resolve";
import { getApiFormat } from "./source";

/**
 * 把客户端 model 字段解析成完整的路由信息
 * 给 HTTP handler 用
 */
export interface RouteInfo {
  source: Source;
  upstreamModelId: string;
  apiFormat: ApiFormat;
}

export function resolveRoute(model: string, config: Config): RouteInfo {
  let resolved: { source: Source; modelId: string } | null = null;
  try {
    resolved = resolveModelRef(model, config);
  } catch (e) {
    if (e instanceof ResolveError) throw e;
    throw e;
  }
  if (!resolved) {
    throw new ResolveError(`Unknown model: "${model}". Use \`sub/model\` format or the auto-generated short alias from \`cctra ls\`.`);
  }
  return {
    source: resolved.source,
    upstreamModelId: resolved.modelId,
    apiFormat: getApiFormat(resolved.source),
  };
}
