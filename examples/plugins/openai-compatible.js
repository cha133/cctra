// ============================================================================
// 示例插件：标准 OpenAI 兼容端点（无鉴权）
// 复制到 ~/.cctra/plugins/openai-compatible.js 后用 `cctra plugin add` 注册
// ============================================================================

export default {
  name: "openai-compatible",
  displayName: "OpenAI-Compatible Endpoint",

  async getConfig(ctx) {
    // 用户填的 config（来自 cctra plugin add 时输入）
    const { baseUrl, token, modelIds } = ctx.config;

    return modelIds.map((id) => ({
      baseUrl: baseUrl.replace(/\/+$/, ""),
      path: "/v1/chat/completions",
      apiFormat: "openai-chat",
      authHeader: token ? { Authorization: `Bearer ${token}` } : {},
      modelId: id,
    }));
  },

  async listModels(ctx) {
    const { modelIds } = ctx.config;
    return modelIds.map((id) => ({ id, alias: id }));
  },
};
