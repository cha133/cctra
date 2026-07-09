# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install                    # install deps
bun run src/index.ts           # run CLI
bun run src/index.ts serve     # start HTTP server on 127.0.0.1:3133
bun test                       # run all tests (bun test runner)
bunx tsc --noEmit              # type-check only
bun run verify                 # type-check + test

# run a single test file
bun test tests/convert.test.ts

# run a single test or describe block (bun supports --match)
bun test --match "Chat → Canonical"

# run streaming-specific tests (filter by directory or name)
bun test tests/convert.test.ts --match "stream"
```

## Architecture overview

cctra is a local protocol converter for LLMs. A **Canonical** internal type system sits between inbound and outbound conversion, so adding a protocol costs O(N) conversion functions, not O(N²).

**Key directories:**

- `src/canonical/types.ts` — the pivot type system (`CanonicalRequest` / `CanonicalResponse` / content blocks / streaming chunks)
- `src/convert/inbound/` — 3 client wire formats → Canonical (chat, responses, anthropic)
- `src/convert/outbound/` — Canonical → 3 client wire formats
- `src/convert/upstream/` — Canonical → upstream wire (2 formats) + rectifier subsystem for vendor quirks
- `src/convert/streaming/` — streaming equivalents (3 inbound + 3 outbound), physically separate from non-streaming
- `src/convert/common/` — shared helpers (extras, content-blocks, tool-calls, system-prompt, usage, reasoning)
- `src/server/` — Bun.serve() route table, 4 handlers, upstream fetch orchestration, SSE, parsers
- `src/core/` — alias system, model resolution, config CRUD, namespace defense, model-fetch cache
- `src/plugin/` — local-path plugin loader + `UpstreamPlugin` author contract
- `src/commands/` — 13 CLI subcommand implementations
- `src/ui/` — @clack/prompts wrappers, picocolors formatting, hand-rolled table

**Request lifecycle:** handler → `resolveModelRef()` → inbound convert → upstream convert → fetch → parse → outbound convert → respond. See `ARCHITECTURE.md` for full walkthrough.

## Critical patterns

### ProtocolExtras / forward-compat invariant

Unknown fields are never dropped. Each `Canonical*` type has a `ProtocolExtras` bucket per protocol (`anthropic` / `openaiChat` / `openaiResponses`). `splitKnownAndExtras()` preserves unrecognized fields on inbound; `mergeExtras()` spreads them back on outbound. If a field silently disappears, that's a bug.

### Streaming conversion is split from non-streaming

Streaming converters (`src/convert/streaming/`) are physically separate from their non-streaming counterparts because streaming has its own state machine (tool-call-id → stable index mapping for Anthropic's `content_block_index`, delta coalescing, finish-reason detection). Don't merge them.

### Rectifier subsystem

`src/convert/upstream/rectify/` is a per-provider quirk-compatibility layer. Rules are onion-style composable, registered in `registry.ts`, and applied via `runRectifiers()` before upstream fetch. Example: `normalize-thinking-type` coerces Anthropic `thinking.type` shorthand.

### Alias system

`Config.aliases` is a flat `Record<string, string>`. Auto-registration silently creates an alias when a model id is globally unique. `cctra switch` is the only CLI command that hot-reloads the running server (others edit `config.toml`). One namespace for aliases, providers, and plugins — enforced by `namespace.ts`.

### Upstream plugin system

Two modes: **declarative** (`getConfig()` returns endpoint config) and **functional** (`fetch()`/`fetchStream()` receives full CanonicalRequest). Plugins are arbitrary JS files loaded via `import()` with cache-busting. No sandbox in v1.

## Testing conventions

- **Unit tests**: direct function calls with fixture objects. `convert.test.ts` covers all 16 conversion functions (8 non-streaming + 8 streaming with SSE event fixtures).
- **Integration tests**: `server.test.ts` spins up real `Bun.serve()` + an in-process mock upstream. Covers all 9 protocol combinations (3 client × 3 upstream). Uses `CCTRA_CONFIG` env var + `mkdtempSync` for isolation — never mutates real config.
- **Mock upstream**: `tests/integration/mock-upstream.ts` provides echo endpoints for each protocol and tool-call fixture endpoints.
- **Isolation**: set `CCTRA_NO_MIGRATE=1` and `CCTRA_CONFIG` to a temp dir to avoid touching `~/.config/cctra/`.
- **Hard-coded port**: integration tests use port 31444. Concurrent test runs collide (known debt, not a concern for single-user dev).

## Notable constraints

- Bun-native. Uses `Bun.serve()`, `AbortSignal.any()`, `bun test`. No Node.js compatibility layer.
- Listens on `127.0.0.1:3133` only. No auth, rate-limit, or body-size limit — localhost-only threat model.
- XDG paths: `~/.config/cctra/config.toml`, `~/.cache/cctra/models-cache.json`, `~/.local/state/cctra/serve.pid`.
- Model field: `provider/model` or global alias. Bare model id (no `/`) is rejected unless it matches an alias.
