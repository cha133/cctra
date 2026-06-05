# cctra

> Local LLM subscription protocol converter + plugin host

`cctra` runs a daemon on `127.0.0.1:3133` that translates between **OpenAI Chat Completions / OpenAI Responses / Anthropic Messages**, with a **tier-based model aliasing** system and **local-path plugin** support for non-standard upstream auth (OAuth, mTLS, etc.).

## Quick start

```bash
# install (once)
bun add -g cctra
# or npm i -g cctra

# add a subscription (interactive)
cctra add

# start the daemon (foreground)
cctra serve

# or install as system startup item (Windows / macOS / Linux)
cctra daemon install
cctra daemon start
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
cctra daemon install / uninstall / start / stop / status
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
- `src/daemon/` — cross-platform install (Windows registry / macOS LaunchAgent / Linux systemd)
- `launcher/` — tiny Rust .exe for Windows startup (hides console, registers in Task Manager)

## License

MIT — see [LICENSE](LICENSE).
