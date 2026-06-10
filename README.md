# cctra

> Local LLM subscription protocol converter + plugin host

`cctra` runs a local HTTP server on `127.0.0.1:3133` that translates between **OpenAI Chat Completions / OpenAI Responses / Anthropic Messages**, with **per-model aliases** and **local-path plugin** support for non-standard upstream auth (OAuth, mTLS, etc.).

## Quick start

```bash
# install (once)
bun add -g cctra
# or npm i -g cctra

# add a subscription (interactive)
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

### Client configuration

⚠️ **baseURL must include the protocol namespace prefix**:

| Client | baseURL |
|---|---|
| Claude Code | `http://127.0.0.1:3133/anthropic` |
| OpenAI SDK / Codex / Cursor | `http://127.0.0.1:3133/v1` |

## Model aliases

When you add a model, cctra **auto-generates a short alias equal to the model id** (as long as that id is unique across all your sources). That alias works as the `model` field in client requests — you don't need to type the full `provider/model` name every time.

```bash
# Add a subscription
cctra add   # pick Ark Coding Plan + deepseek-v4-pro
#   → config.toml now has: id="deepseek-v4-pro", alias="deepseek-v4-pro"
#   → you can use "deepseek-v4-pro" as the model name in any client
```

```bash
# Add another source with a model of the same id
cctra add   # pick DeepSeek + deepseek-v4-pro
#   → alias collision: the first one keeps it, the second has no alias
#   → access the first via short alias "deepseek-v4-pro"
#   → access the second only via the full name "deepseek/deepseek-v4-pro"
```

To inspect the current alias → full name mapping:

```bash
cctra ls
# ALIAS              FULL NAME                              SOURCE
# ───────────────────────────────────────────────────────────
# deepseek-v4-pro    ark-coding-plan/deepseek-v4-pro        Ark Coding Plan
# d3                 ark-coding-plan/deepseek-v3            Ark Coding Plan
# (none)             deepseek/deepseek-v4-pro               DeepSeek
```

To override the auto-generated alias, use `cctra model rename`:

```bash
cctra model rename ark-coding-plan deepseek-v4-pro d4p
```

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
cctra add                    # interactive subscription wizard
cctra ls                     # list all models (alias → full name)
cctra show <name>            # show details
cctra rm <name>              # remove
cctra rename <old> <new>     # rename
cctra model add <sub>        # add model to a subscription
cctra model ls <sub>         # list models
cctra model rm <sub> <m>     # remove model
cctra model rename <sub> <m> <alias>
cctra plugin add <name> <path>
cctra plugin ls / show / enable / disable / rm
cctra serve [--port N]       # foreground HTTP server
```

## Configuration

Persisted at `~/.cctra/config.toml` (TOML format, edited via CLI).

Plugin configs go in `~/.cctra/plugins/<name>/config.json`.

## Architecture

- `src/canonical/` — protocol-agnostic internal types
- `src/convert/` — bidirectional protocol conversions
- `src/server/` — Bun.serve() routes, upstream forwarding
- `src/plugin/` — local-path plugin loader + author contract
- `src/core/alias.ts` — auto-alias 决策（id 全局唯一 → 静默设 alias）

## Credits

The vendor preset list (`src/providers/presets.ts`) — provider names and endpoint URLs — is derived from [cc-switch](https://github.com/farion1231/cc-switch) (MIT, Copyright (c) 2025 Jason Young). Thanks to Jason and the cc-switch contributors for maintaining this comprehensive registry.

## License

MIT — see [LICENSE](LICENSE).
