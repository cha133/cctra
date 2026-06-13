# cctra

> Local LLM provider protocol converter + plugin host

`cctra` runs a local HTTP server on `127.0.0.1:3133` that translates between **OpenAI Chat Completions / OpenAI Responses / Anthropic Messages**, with a **global alias table** (rebind without restarting the client) and **local-path plugin** support for non-standard upstream auth (OAuth, mTLS, etc.).

## Quick start

```bash
# install (once)
bun add -g cctra
# or npm i -g cctra

# add a provider (interactive wizard)
cctra add

# start the server (foreground)
cctra serve
```

## Endpoints

cctra exposes exactly **3 protocol endpoints** on `127.0.0.1:3133`:

| Protocol | Path |
|---|---|
| Anthropic Messages | `POST /anthropic/v1/messages` |
| OpenAI Chat Completions | `POST /v1/chat/completions` |
| OpenAI Responses | `POST /v1/responses` |
| OpenAI Models | `GET /v1/models` |
| Health | `GET /healthz` |

## Aliases — the only short-name system

cctra has one place where every short name lives: the **`[aliases]` table** in `~/.cctra/config.toml`. An alias is a name → `provider/model` pointer; clients send the alias as their `model` field and cctra routes to the upstream.

Three things to know:

1. **Auto-generated**: when you `cctra add` a provider, every model whose id is globally unique gets `aliases[id] = "provider/id"` for free — clients can use the short id immediately, no `provider/` prefix needed.
2. **Manual slots for stable client config**: cctra pre-seeds three empty aliases — `cctra-pro` / `cctra-flash` / `cctra-vision`. Bind them with `cctra switch <name>` and your Claude Code / Codex configs can hard-code those names forever; switching upstreams is a one-line CLI call that hot-reloads (no client restart).
3. **Add your own**: `cctra alias add <name>` for empty slots, `cctra alias <name> <target>` to set in one shot.

```bash
cctra add                       # walks the wizard, auto-aliases unique ids
cctra alias                     # list all aliases (bound + unbound)
cctra switch cctra-pro          # interactive: pick a model from the dropdown
cctra switch cctra-pro ark/doubao-seed-1-6   # non-interactive
cctra alias rm cctra-vision     # remove a slot you don't use
```

`cctra ls` shows everything at a glance:

```bash
cctra ls
# ALIASES
#   cctra-pro         → ark-sub/doubao-seed-1-6   [Ark Sub]
#   doubao-seed-1-6   → ark-sub/doubao-seed-1-6   [Ark Sub]
#   sonnet            → or/anthropic/claude-3.5   [OpenRouter]
#
# UNBOUND
#   cctra-flash
#   cctra-vision
#
# OTHER MODELS
#   ark-sub/doubao-1-5-pro    [Ark Sub]
#   ark-sub/doubao-1-5-vision [Ark Sub]
```

## Client integration

Each client picks its `baseURL` + `model` field to hit the right protocol endpoint. Two clients that speak the same protocol (e.g. Claude Code and any other Anthropic-SDK-based client) use the same `baseURL` — only the `model` field varies.

> ⚠️ **baseURL must include the protocol namespace prefix.** Pointing a Chat-Completions client at `/anthropic` (or vice-versa) will hit the wrong route and fail.

### Claude Code

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:3133/anthropic
export ANTHROPIC_AUTH_TOKEN=anything  # cctra 不验 Anthropic 客户端的 token；填任意占位即可
```

`model` field can be any alias (`cctra-pro` / `cctra-flash` / `provider-unique-id`) or full name (`provider/id`). The `[1m]` context suffix is processed client-side by Claude Code — cctra never sees it.

### Codex (and OpenAI SDK / Cursor)

```bash
export OPENAI_BASE_URL=http://127.0.0.1:3133/v1
export OPENAI_API_KEY=anything  # 同上，cctra 不验 OpenAI 客户端的 key
```

Codex defaults to the Chat Completions path (`/v1/chat/completions`). For the Responses path (`/v1/responses`), the client must be configured to send there explicitly — cctra will route whichever path the client picks.

### 任意 OpenAI 兼容客户端（opencode / 其他）

`baseURL` = `http://127.0.0.1:3133/v1`. The client picks the path:
- requests to `/v1/chat/completions` → Chat path
- requests to `/v1/responses` → Responses path

If the client allows custom paths, prefer `/v1/responses` — it's closer to cctra's canonical model and carries more forward-compat extras (per 0.6.0 parity work). opencode / Continue.dev / Aider / any custom OpenAI-SDK wrapper fall into this category.

### Model field: 全名 vs alias

- **Alias 短名**（`cctra-pro` / `cctra-flash` / `provider-unique-id`）— 推荐
  - 客户端写死 `model: cctra-pro`，服务端 `cctra switch cctra-pro <new-target>` 热切上游，client 不需要改
  - 3 个预置空槽（`cctra-pro` / `cctra-flash` / `cctra-vision`）走 `cctra alias add` 或 `cctra switch` 绑定
- **全名**（`provider/id`，如 `or/anthropic/claude-3.5`）— 锁定上游时
  - 不依赖 alias 表，配置文件丢了也能 resolve
  - 切上游要改 client 的 `model` 字段

### Known inter-protocol incompatibilities

cctra's canonical layer is best-effort, not lossless. When you mix protocols, expect these:

1. **`document` blocks 丢** — Anthropic `document` (PDF/图片) → Chat/Responses upstream 静默丢。仅 Anthropic↔Anthropic round-trip 安全。
2. **`thinking` / `signature` deltas 丢** — Chat 路径无对应字段。Anthropic↔Responses round-trip 文本保留，signature 丢。
3. **`redacted_thinking` 降级文本** — 在 Chat/Responses 客户端呈现为 `[redacted_thinking]` literal 字符串（0.5.1 实现）。
4. **`refusal` 块变文本** — Chat 上游的 refusal → Anthropic 客户端看到 `[refusal] …` 普通 text block，Claude Code refusal 分支不会触发。
5. **`image` parts 在 Chat/Responses 出站被 re-encode 成 `data:` URL** — 即使入站是 URL 也重编码，payload 涨；远程大图要走 Chat 上游时尤其明显。
6. **未知 block / item 占位** — Anthropic 未知 block → `[unknown_block:<type>]`；Responses 未知 item → `[unknown_input_item:<type>]`（含 `web_search_call` / `mcp_call` 等 5 个内置 tool）。原 payload 保留在 `extras` 里。
7. **`stop_reason: "error"` → `"refusal"`** — 0.5.1 修复；Chat 上游 `content_filter` 让 Anthropic 客户端看到 refusal 事件。
8. **Anthropic `system` 数组（带 `cache_control`）丢 cache_control** — Chat 顶层 system 是 string 无元数据空间，cache_control 元信息无法承载。

## Plugin system

Add custom JS plugins for non-standard upstream auth:

```bash
cctra plugin add my-internal /path/to/my-internal.js
cctra plugin ls
cctra plugin enable my-internal
cctra plugin disable my-internal
cctra plugin rm my-internal
```

A plugin exports:

```js
export default {
  name: "my-internal-llm",
  displayName: "My Company LLM",
  async getConfig(ctx) {
    // OAuth / mTLS / custom header logic
    return { baseUrl: "...", path: "/v1/chat/completions", apiFormat: "openai-chat", authHeader: { /* ... */ }, modelId: "..." };
  },
  async listModels(ctx) { return [{ id: "..." }, { id: "..." }]; },
};
```

See `examples/plugins/` for working examples.

## CLI

```
cctra add                       # interactive provider wizard
cctra edit <name>               # edit models on a provider (multiselect)
cctra alias                     # list all aliases (bound + unbound)
cctra alias <name>              # show what an alias points to
cctra alias <name> <target>     # set/create alias (target is `provider/model` or another alias)
cctra alias add <name>          # create an empty alias slot
cctra alias rm <name>           # remove an alias
cctra switch [<name>] [<tgt>]   # interactive switch (prompts when args omitted)
cctra ls                        # list aliases + models
cctra show <name>               # show provider / plugin details
cctra rm <name>                 # remove provider / plugin / model (unbinds related aliases)
cctra rename <old> <new>        # rename provider (updates alias values automatically)
cctra plugin add <name> <path>
cctra plugin ls / show / enable / disable / rm
cctra serve [--port N]          # foreground HTTP server
```

## Configuration

Persisted at `~/.cctra/config.toml` (TOML format, edited via CLI).

Plugin configs go in `~/.cctra/plugins/<name>/config.json`.

## Architecture

- `src/canonical/` — protocol-agnostic internal types
- `src/convert/` — bidirectional protocol conversions
- `src/server/` — Bun.serve() routes, upstream forwarding
- `src/plugin/` — local-path plugin loader + author contract
- `src/core/resolve.ts` — `provider/model` and global `[aliases]` table resolution
- `src/core/alias.ts` — auto-alias decision (id globally unique → silent `aliases[id] = "provider/id"`)

## Credits

The vendor preset list (`src/providers/presets.ts`) — provider names and endpoint URLs — is derived from [cc-switch](https://github.com/farion1231/cc-switch) (MIT, Copyright (c) 2025 Jason Young). Thanks to Jason and the cc-switch contributors for maintaining this comprehensive registry.

## License

MIT — see [LICENSE](LICENSE).
