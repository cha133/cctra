# cctra

Local LLM provider protocol converter + plugin host. Runs a local HTTP server on `127.0.0.1:3133` that translates between **OpenAI Chat Completions / OpenAI Responses / Anthropic Messages** protocols, with **auto-generated per-model aliases** (id 全局唯一 → 静默设 alias=id) and a **local-path plugin system** for non-standard upstream authentication (OAuth, mTLS, etc.).

## Quick start

```bash
bun install
bun run src/index.ts add           # interactive provider wizard
bun run src/index.ts serve         # foreground HTTP server
```

## Architecture

- `src/canonical/` — protocol-agnostic internal types (`CanonicalRequest` / `CanonicalResponse` / content blocks)
- `src/convert/` — bidirectional conversions: 3 client protocols ↔ Canonical, 2 upstream protocols ↔ Canonical
- `src/server/` — Bun.serve() routes, SSE streaming, upstream forwarding
- `src/plugin/` — local-path plugin loader, plugin author contract (`.d.ts` types)
- `src/core/alias.ts` — auto-alias 决策（id 全局唯一 → 静默设 alias=id；冲突 → 留空）

## Conventions

- cctra exposes exactly 3 endpoints:
  - `POST /v1/messages` (Anthropic)
  - `POST /v1/chat/completions` (OpenAI Chat)
  - `POST /v1/responses` (OpenAI Responses)
- Client baseURL convention: `http://127.0.0.1:3133` for Anthropic, `http://127.0.0.1:3133/v1` for OpenAI
- Model field on requests is either `provider/model` or a model alias (auto-generated when the id is unique across all sources)
- CLI commands: `add` / `edit` / `rm` / `rename` / `alias` / `show` / `ls` / `plugin` / `serve`
- Persisted config: `~/.config/cctra/config.toml` via smol-toml
- Plugin configs: `~/.config/cctra/plugins/<name>/config.json`
- Model cache: `~/.cache/cctra/models-cache.json` (regeneratable)
- Runtime state: `~/.local/state/cctra/serve.pid` (recreated on every serve start)

See `README.md` for full usage and the plan at `C:\Users\Admin\.Codex\plans\happy-growing-fairy.md` for design rationale.
