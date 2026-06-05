// ============================================================================
// 示例插件：内部公司服务，OAuth 鉴权
// 演示 token 缓存、refresh、ctx.fetch 用法
// ============================================================================

export default {
  name: "oauth-internal",
  displayName: "Internal OAuth Service",

  async getConfig(ctx) {
    const { clientId, clientSecret, baseUrl, modelIds, workspaceId } = ctx.config;

    // 缓存 token（避免每次请求都重新拿）
    let tokenData = await ctx.cacheGet("oauth-token");
    if (!tokenData) {
      tokenData = await refreshToken(clientId, clientSecret);
      // token 提前 60s 过期，留缓冲
      await ctx.cacheSet("oauth-token", tokenData, (tokenData.expires_in - 60) * 1000);
      ctx.logger(`refreshed OAuth token, expires in ${tokenData.expires_in}s`);
    }

    return modelIds.map((id) => ({
      baseUrl: baseUrl.replace(/\/+$/, ""),
      path: "/v1/chat/completions",
      apiFormat: "openai-chat",
      authHeader: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "X-Workspace-Id": workspaceId,
      },
      modelId: id,
    }));
  },

  async listModels(ctx) {
    return ctx.config.modelIds.map((id) => ({ id }));
  },
};

async function refreshToken(_clientId, _clientSecret) {
  // v1 示例：实际应调用 OAuth 端点
  // 这里模拟一个 token
  return {
    access_token: "simulated-token-" + Date.now(),
    expires_in: 3600,
  };
}
