# cctra

> Local LLM subscription protocol converter + plugin host

`cctra` runs a local HTTP server on `127.0.0.1:3133` that translates between **OpenAI Chat Completions / OpenAI Responses / Anthropic Messages**, with a **tier-based model aliasing** system and **local-path plugin** support for non-standard upstream auth (OAuth, mTLS, etc.).

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

## Tier aliases

cctra ships 4 built-in semantic tier names that you map to concrete `(subscription, model)` pairs:

| Tier | Purpose |
|---|---|
| `cctra` | Default (medium quality, cheap) |
| `cctra-pro` | Deep reasoning (slow but strong) |
| `cctra-flash` | High speed (small & fast) |
| `cctra-vision` | Multimodal |

```bash
# map cctra-pro to your actual deepseek model
cctra tier set cctra-pro ark-agent-plan/deepseek-v4-pro

# now configure Claude Code to use it (won't change when you switch models)
# ANTHROPIC_MODEL=cctra-pro
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
cctra ls                     # list all sources
cctra show <name>            # show details
cctra rm <name>              # remove
cctra rename <old> <new>     # rename
cctra model add <sub>        # add model to a subscription
cctra model ls <sub>         # list models
cctra model rm <sub> <m>     # remove model
cctra model rename <sub> <m> <alias>
cctra plugin add <name> <path>
cctra plugin ls / show / enable / disable / rm
cctra tier set <name> <target>
cctra tier ls / show / rm
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
- `src/tier/` — 4 builtin tier system

## Credits

The vendor preset list (`src/providers/presets.ts`) — provider names and endpoint URLs — is derived from [cc-switch](https://github.com/farion1231/cc-switch) (MIT, Copyright (c) 2025 Jason Young). Thanks to Jason and the cc-switch contributors for maintaining this comprehensive registry.

## License

MIT — see [LICENSE](LICENSE).
