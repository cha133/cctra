# cctra

Local LLM subscription protocol converter + plugin host. Runs a local HTTP server on `127.0.0.1:3133` that translates between **OpenAI Chat Completions / OpenAI Responses / Anthropic Messages** protocols, with a **tier-based model aliasing** system (`cctra-pro` → any concrete model) and a **local-path plugin system** for non-standard upstream authentication (OAuth, mTLS, etc.).

## Quick start

```bash
bun install
bun run dev -- add           # interactive subscription wizard
bun run dev -- serve         # foreground HTTP server
```

## Architecture

- `src/canonical/` — protocol-agnostic internal types (`CanonicalRequest` / `CanonicalResponse` / content blocks)
- `src/convert/` — bidirectional conversions: 3 client protocols ↔ Canonical, 2 upstream protocols ↔ Canonical
- `src/server/` — Bun.serve() routes, SSE streaming, upstream forwarding
- `src/plugin/` — local-path plugin loader, plugin author contract (`.d.ts` types)
- `src/tier/` — 4 builtin tiers (`cctra` / `cctra-pro` / `cctra-flash` / `cctra-vision`) + user-defined

## Conventions

- cctra exposes exactly 3 endpoints:
  - `POST /anthropic/v1/messages` (Anthropic)
  - `POST /v1/chat/completions` (OpenAI Chat)
  - `POST /v1/responses` (OpenAI Responses)
- Client baseURL convention: `http://127.0.0.1:3133/anthropic` or `http://127.0.0.1:3133/v1`
- Model field on requests is either a tier name (`cctra-pro`), `subscription/model`, or a model alias
- Persisted config: `~/.cctra/config.toml` via confbox
- Plugin configs: `~/.cctra/plugins/<name>/config.json`

See `README.md` for full usage and the plan at `C:\Users\Admin\.claude\plans\happy-growing-fairy.md` for design rationale.
