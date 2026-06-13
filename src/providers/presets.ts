// ============================================================================
// Vendor 预设：从 cc-switch 三个 preset 文件人工筛选 + 翻译成 cctra 精简版
// ============================================================================
//
// 数据来源（vendor 名称 & endpoint URL）：
//   cc-switch (MIT, Copyright (c) 2025 Jason Young)
//   https://github.com/farion1231/cc-switch
//   - src/config/claudeProviderPresets.ts (Anthropic 格式)
//   - src/config/codexProviderPresets.ts   (OpenAI Chat / Responses)
//   - src/config/geminiProviderPresets.ts  (OpenAI Responses 兼容)
//
// cctra preset 设计：
//   - 一个 vendor 可以有多个协议端点（如 Ark 同时支持 Anthropic + OpenAI Chat）
//   - add wizard 选中 preset 后，下一步协议选择只显示该 preset 支持的协议
//   - 「手动配置」才允许 3 种协议全选
// ============================================================================

import type { ApiFormat } from "../canonical/types";

export type ProviderEndpoints = Partial<Record<ApiFormat, string>>;

export interface ProviderPreset {
  name: string;                   // 显示名
  endpoints: ProviderEndpoints;   // 每个协议对应的 base URL
  notes?: string;                 // 特殊处理备注
}

export const API_FORMAT_LABELS: Record<ApiFormat, string> = {
  "openai-chat": "OpenAI Chat Completions",
  "openai-responses": "OpenAI Responses",
  "anthropic-messages": "Anthropic Messages",
};

// ============================================================================
// Provider 预设（从 cc-switch 精确抄录，一个 vendor 可声明多个协议端点）
// ============================================================================
export const providerPresets: ProviderPreset[] = [
  // ---- Anthropic + OpenAI Chat ----
  { name: "Ark Agent Plan", endpoints: { "anthropic-messages": "https://ark.cn-beijing.volces.com/api/plan", "openai-chat": "https://ark.cn-beijing.volces.com/api/plan/v3" } },
  { name: "Ark Coding Plan", endpoints: { "anthropic-messages": "https://ark.cn-beijing.volces.com/api/coding", "openai-chat": "https://ark.cn-beijing.volces.com/api/coding/v3" } },
  { name: "Shengsuanyun", endpoints: { "anthropic-messages": "https://router.shengsuanyun.com/api", "openai-chat": "https://router.shengsuanyun.com/api/v1" } },
  { name: "PatewayAI", endpoints: { "anthropic-messages": "https://api.pateway.ai", "openai-chat": "https://api.pateway.ai/v1" } },
  { name: "BytePlus", endpoints: { "anthropic-messages": "https://ark.ap-southeast.bytepluses.com/api/coding", "openai-chat": "https://ark.ap-southeast.bytepluses.com/api/coding/v3" } },
  { name: "DouBaoSeed", endpoints: { "anthropic-messages": "https://ark.cn-beijing.volces.com/api/compatible", "openai-chat": "https://ark.cn-beijing.volces.com/api/v3" } },
  { name: "DeepSeek", endpoints: { "anthropic-messages": "https://api.deepseek.com/anthropic", "openai-chat": "https://api.deepseek.com" } },
  { name: "Zhipu GLM", endpoints: { "anthropic-messages": "https://open.bigmodel.cn/api/anthropic", "openai-chat": "https://open.bigmodel.cn/api/coding/paas/v4" } },
  { name: "Zhipu GLM en", endpoints: { "anthropic-messages": "https://api.z.ai/api/anthropic", "openai-chat": "https://api.z.ai/api/coding/paas/v4" } },
  { name: "Baidu Qianfan Coding Plan", endpoints: { "anthropic-messages": "https://qianfan.baidubce.com/anthropic/coding", "openai-chat": "https://qianfan.baidubce.com/v2/coding" } },
  { name: "Bailian", endpoints: { "anthropic-messages": "https://dashscope.aliyuncs.com/apps/anthropic", "openai-chat": "https://dashscope.aliyuncs.com/compatible-mode/v1" } },
  { name: "Kimi", endpoints: { "anthropic-messages": "https://api.moonshot.cn/anthropic", "openai-chat": "https://api.moonshot.cn/v1" } },
  { name: "StepFun", endpoints: { "anthropic-messages": "https://api.stepfun.com/step_plan", "openai-chat": "https://api.stepfun.com/step_plan/v1" } },
  { name: "StepFun en", endpoints: { "anthropic-messages": "https://api.stepfun.ai/step_plan", "openai-chat": "https://api.stepfun.ai/step_plan/v1" } },
  { name: "ModelScope", endpoints: { "anthropic-messages": "https://api-inference.modelscope.cn", "openai-chat": "https://api-inference.modelscope.cn/v1" } },
  { name: "Longcat", endpoints: { "anthropic-messages": "https://api.longcat.chat/anthropic", "openai-chat": "https://api.longcat.chat/openai/v1" } },
  { name: "MiniMax", endpoints: { "anthropic-messages": "https://api.minimaxi.com/anthropic", "openai-chat": "https://api.minimaxi.com/v1" } },
  { name: "MiniMax en", endpoints: { "anthropic-messages": "https://api.minimax.io/anthropic", "openai-chat": "https://api.minimax.io/v1" } },
  { name: "BaiLing", endpoints: { "anthropic-messages": "https://api.tbox.cn/api/anthropic", "openai-chat": "https://api.tbox.cn/api/llm/v1" } },
  { name: "Xiaomi MiMo", endpoints: { "anthropic-messages": "https://api.xiaomimimo.com/anthropic", "openai-chat": "https://api.xiaomimimo.com/v1" } },
  { name: "Xiaomi MiMo Token Plan (China)", endpoints: { "anthropic-messages": "https://token-plan-cn.xiaomimimo.com/anthropic", "openai-chat": "https://token-plan-cn.xiaomimimo.com/v1" } },
  { name: "SiliconFlow", endpoints: { "anthropic-messages": "https://api.siliconflow.cn", "openai-chat": "https://api.siliconflow.cn/v1" } },
  { name: "SiliconFlow en", endpoints: { "anthropic-messages": "https://api.siliconflow.com", "openai-chat": "https://api.siliconflow.com/v1" } },
  { name: "Novita AI", endpoints: { "anthropic-messages": "https://api.novita.ai/anthropic", "openai-chat": "https://api.novita.ai/openai/v1" } },
  { name: "Nvidia NIM", endpoints: { "anthropic-messages": "https://integrate.api.nvidia.com", "openai-chat": "https://integrate.api.nvidia.com/v1" } },
  { name: "AiHubMix", endpoints: { "anthropic-messages": "https://aihubmix.com", "openai-chat": "https://aihubmix.com/v1" }, notes: "ANTHROPIC_API_KEY header（不是 ANTHROPIC_AUTH_TOKEN）" },
  { name: "CherryIN", endpoints: { "anthropic-messages": "https://open.cherryin.net", "openai-chat": "https://open.cherryin.net/v1" } },
  { name: "DMXAPI", endpoints: { "anthropic-messages": "https://www.dmxapi.cn", "openai-chat": "https://www.dmxapi.cn/v1" } },
  { name: "PackyCode", endpoints: { "anthropic-messages": "https://www.packyapi.com", "openai-chat": "https://www.packyapi.com/v1" } },
  { name: "AtlasCloud", endpoints: { "anthropic-messages": "https://api.atlascloud.ai", "openai-chat": "https://api.atlascloud.ai/v1" } },
  { name: "ClaudeCN", endpoints: { "anthropic-messages": "https://claudecn.top", "openai-chat": "https://claudecn.top/v1" } },
  { name: "RunAPI", endpoints: { "anthropic-messages": "https://runapi.co", "openai-chat": "https://runapi.co/v1" } },
  { name: "RelaxyCode", endpoints: { "anthropic-messages": "https://www.relaxycode.com", "openai-chat": "https://www.relaxycode.com/v1" } },
  { name: "Cubence", endpoints: { "anthropic-messages": "https://api.cubence.com", "openai-chat": "https://api.cubence.com/v1" } },
  { name: "AIGoCode", endpoints: { "anthropic-messages": "https://api.aigocode.com", "openai-chat": "https://api.aigocode.com" } },
  { name: "RightCode", endpoints: { "anthropic-messages": "https://www.right.codes/claude", "openai-chat": "https://right.codes/codex/v1" } },
  { name: "AICodeMirror", endpoints: { "anthropic-messages": "https://api.aicodemirror.com/api/claudecode", "openai-chat": "https://api.aicodemirror.com/api/codex/backend-api/codex" } },
  { name: "CrazyRouter", endpoints: { "anthropic-messages": "https://cn.crazyrouter.com", "openai-chat": "https://cn.crazyrouter.com/v1" } },
  { name: "SSSAiCode", endpoints: { "anthropic-messages": "https://node-hk.sssaicode.com/api", "openai-chat": "https://node-hk.sssaicode.com/api/v1" } },
  { name: "Compshare", endpoints: { "anthropic-messages": "https://api.modelverse.cn", "openai-chat": "https://api.modelverse.cn/v1" } },
  { name: "Compshare Coding Plan", endpoints: { "anthropic-messages": "https://cp.compshare.cn", "openai-chat": "https://cp.compshare.cn/v1" } },
  { name: "Micu", endpoints: { "anthropic-messages": "https://www.micuapi.ai", "openai-chat": "https://www.micuapi.ai/v1" } },
  { name: "CTok.ai", endpoints: { "anthropic-messages": "https://api.ctok.ai", "openai-chat": "https://api.ctok.ai/v1" } },
  { name: "LemonData", endpoints: { "anthropic-messages": "https://api.lemondata.cc", "openai-chat": "https://api.lemondata.cc/v1" } },
  { name: "OpenRouter", endpoints: { "anthropic-messages": "https://openrouter.ai/api", "openai-chat": "https://openrouter.ai/api/v1" } },
  { name: "TheRouter", endpoints: { "anthropic-messages": "https://api.therouter.ai", "openai-chat": "https://api.therouter.ai/v1" } },

  // ---- Anthropic + OpenAI Responses ----
  { name: "APIKEY.FUN", endpoints: { "anthropic-messages": "https://api.apikey.fun", "openai-responses": "https://api.apikey.fun/v1" } },
  { name: "APINebula", endpoints: { "anthropic-messages": "https://apinebula.com", "openai-responses": "https://apinebula.com/v1" } },
  { name: "SudoCode", endpoints: { "anthropic-messages": "https://sudocode.us", "openai-responses": "https://sudocode.us/v1" } },
  { name: "E-FlowCode", endpoints: { "anthropic-messages": "https://e-flowcode.cc", "openai-responses": "https://e-flowcode.cc/v1" } },
  { name: "PIPELLM", endpoints: { "anthropic-messages": "https://cc-api.pipellm.ai", "openai-responses": "https://cc-api.pipellm.ai/v1" } },

  // ---- Anthropic 独有（claudeProviderPresets 有但 codex 没有同名项）----
  { name: "Bailian For Coding", endpoints: { "anthropic-messages": "https://coding.dashscope.aliyuncs.com/apps/anthropic" } },
  { name: "Kimi For Coding", endpoints: { "anthropic-messages": "https://api.kimi.com/coding" } },
  { name: "ClaudeAPI", endpoints: { "anthropic-messages": "https://gw.claudeapi.com" } },

  // ---- OpenAI Chat 独有（codex 有但 claude 没有同名项）----
  { name: "OpenCode Go", endpoints: { "openai-chat": "https://opencode.ai/zen/go" } },
  { name: "OpenAI Official", endpoints: { "openai-chat": "https://api.openai.com/v1" } },
  { name: "GitHub Copilot", endpoints: { "openai-chat": "https://api.githubcopilot.com" }, notes: "需要 OAuth（暂不支持 API key 登录）" },

  // ---- OpenAI Responses 独有 ----
  { name: "Codex (ChatGPT Plus/Pro)", endpoints: { "openai-responses": "https://chatgpt.com/backend-api/codex" }, notes: "需要 ChatGPT Plus/Pro OAuth token" },
  { name: "Gemini OpenAI-Compat", endpoints: { "openai-responses": "https://generativelanguage.googleapis.com/v1beta/openai" }, notes: "Google Gemini 官方 OpenAI 兼容端点" },
  { name: "OpenAI Responses (Official)", endpoints: { "openai-responses": "https://api.openai.com" } },
];

/**
 * 「手动配置」special entry（用于纯手输流程）
 */
export const NO_VENDOR: ProviderPreset = {
  name: "手动配置",
  endpoints: {},
  notes: "",
};

/**
 * 获取供应商列表，第一项是「手动配置」
 */
export function getVendorChoices(): ProviderPreset[] {
  return [NO_VENDOR, ...providerPresets];
}

/**
 * 获取 preset 支持的协议；自定义 preset 支持全部 3 种协议
 */
export function getSupportedApiFormats(preset: ProviderPreset): ApiFormat[] {
  if (preset === NO_VENDOR || preset.name === NO_VENDOR.name) {
    return ["openai-chat", "openai-responses", "anthropic-messages"];
  }
  return (["anthropic-messages", "openai-chat", "openai-responses"] as const)
    .filter((format) => Boolean(preset.endpoints[format]));
}

/**
 * 获取协议对应 endpoint
 */
export function getEndpointForFormat(preset: ProviderPreset, format: ApiFormat): string {
  return preset.endpoints[format] ?? "";
}

/**
 * 供应商选择列表 hint
 */
export function getPresetHint(preset: ProviderPreset): string | undefined {
  const formats = getSupportedApiFormats(preset);
  if (formats.length === 0) return undefined;
  const formatLabels = formats.map((format) => API_FORMAT_LABELS[format]).join(" / ");
  const firstEndpoint = preset.endpoints[formats[0]!];
  return firstEndpoint ? `${formatLabels}: ${firstEndpoint}` : formatLabels;
}

/**
 * 根据供应商名生成 kebab-case profile 名称
 * 例：
 *   "Ark Agent Plan"                 → "ark-agent-plan"
 *   "APIKEY.FUN"                     → "apikey-fun"
 *   "Xiaomi MiMo Token Plan (China)" → "xiaomi-mimo-token-plan-china"
 */
export function generateProfileName(vendorName: string): string {
  return vendorName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")  // 非字母数字 → 连字符
    .replace(/-+/g, "-")          // 合并连续连字符
    .replace(/^-|-$/g, "");       // 去首尾连字符
}
