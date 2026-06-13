# cctra — Architecture

> A deep-dive into **why** cctra is shaped the way it is and **how a single request flows through it**. For installation, quick start, CLI reference, and client integration see [README.md](./README.md). For agent-facing project instructions see [CLAUDE.md](./CLAUDE.md). For "what's left to do" see [TODO.md](./TODO.md).

---

## 1. Overview

cctra is a local HTTP protocol-converter + plugin host for LLM providers. It runs a single Bun process on `127.0.0.1:3133` that exposes three endpoints — `POST /v1/messages`, `POST /v1/chat/completions`, `POST /v1/responses` — translates between them and the upstream protocol(s) the user's subscriptions / plugins speak, and serves a unified `GET /v1/models` + `GET /healthz`.

The defining design choice: a **protocol-agnostic internal type system** (`Canonical`) sits between inbound and outbound conversion, so adding a fourth client protocol or a third upstream protocol costs **O(N) conversion functions**, not O(N²) pairwise mappings. Anthropic was chosen as the shape-of-record for the canonical model because it's the most expressive of the three (rich content blocks, separated system, explicit `tool_use` / `tool_result` pairing).

Three forces shaped the rest of the design:

- **Clients speak what they speak.** A user moving from `https://api.anthropic.com` to cctra should change only the host portion of `baseURL`. All three endpoints live under the root (`/v1/messages`, `/v1/chat/completions`, `/v1/responses`) so the Anthropic SDK works with `baseURL=http://127.0.0.1:3133` (it appends `/v1/messages` internally) and OpenAI SDKs with `baseURL=http://127.0.0.1:3133/v1`.
- **Users own their config.** Everything in `~/.cctra/config.toml` is explicit. cctra never auto-detects capabilities, never fails over silently, never holds business credentials (search keys, OAuth tokens, etc.) — those go through plugins.
- **The server is the same binary, foreground or background.** There is no separate daemon process, no Rust launcher, no system-tray integration in v1. You run `cctra serve`; aliases hot-reload without a restart.

---

## 2. Design principles

These four rules are the only test for whether a new feature is in scope. If a proposal violates one of them, it gets rejected (see [TODO.md](./TODO.md) §「应用判例」 for the case law).

1. **Target high-end users.** No hand-holding wizards, no capability auto-detection. Vendor presets exist to save keystrokes, not to save thought.
2. **No auto-detection.** Capability tags, model features, tool permissions — all explicit in `~/.cctra/config.toml`. Clients already have their own tool-deny / capability lists; cctra is not in the business of duplicating that.
3. **No automatic upstream switching.** Cache warmth, billing context, and client expectations all break on silent failover. **Manual** switching is a core feature: `cctra switch <alias> <target>` rebinds a short name and the server hot-reloads on the next request.
4. **No business credentials in cctra.** Search API keys, OAuth tokens, mTLS material — the client should pass them (clients that accept deny lists, like Claude Code), or a plugin should hold them in its own config file. cctra never sees them.

Everything below — the pivot architecture, the extras bucket, the namespace defense, the alias system — is downstream of these four rules.

---

## 3. System topology

### Request lifecycle at a glance

```
[Client]  →  POST /{anthropic|v1}/...
              │
              ▼
        src/server/serve.ts        ← Bun.serve() route table
              │  dispatch by path
              ▼
        src/server/handlers/*      ← path → ApiFormat
              │
              ▼
        src/core/resolve.ts        ← model field → (Source, modelId)
              │  alias / "provider/model" / null
              ▼
        src/convert/inbound/*      ← wire → Canonical  (3 of 3)
              │
              ▼
        src/convert/upstream/*     ← Canonical → upstream wire  (2 of 2)
              │
              ▼
        src/server/upstream.ts     ← fetch (plugin interceptions happen here)
              │
              ▼
        src/server/{chat,responses,anthropic}-parser.ts  ← upstream SSE/JSON → Canonical
              │
              ▼
        src/convert/outbound/*     ← Canonical → client wire  (3 of 3)
              │
              ▼
        [Client]  ←  Response
```

For a streaming request the in/out `convert/*` are replaced by their streaming twins under `src/convert/streaming/{inbound,outbound}/*`, and the parsers stream chunks. See [§5](#5-request-lifecycle) for the function table and a worked walkthrough.

### Directory map

```
src/
├── index.ts                  # commander entry
├── types.ts                  # Config / Source / Subscription / PluginConfig / Model
├── canonical/
│   └── types.ts              # CanonicalRequest/Response + ProtocolExtras
├── convert/
│   ├── common/               # content-blocks, tool-calls, system-prompt, usage, reasoning, extras
│   ├── inbound/              # 3 client protocols → Canonical
│   ├── outbound/             # Canonical → 3 client protocols
│   ├── upstream/             # Canonical → 2 upstream protocols
│   └── streaming/            # SSE/streaming equivalents (3 in + 3 out)
├── server/                   # Bun.serve() + handlers + upstream forwarding + parsers
├── plugin/                   # local-path plugin loader + author contract (.d.ts)
├── core/                     # alias, namespace, resolve, source, model-fetch, config
├── providers/
│   └── presets.ts            # vendor preset registry (derived from cc-switch)
├── commands/                 # CLI subcommands (add/edit/ls/show/rm/rename/switch/alias/plugin/serve)
├── ui/                       # @clack/prompts wrappers + picocolors + hand-rolled table
└── utils/                    # fuzzy match, logger, paths
```

For the directory map the user sees from the README (5-bullet form, no rationale), see [README.md § Architecture](./README.md#architecture).

---

## 4. Data model: Canonical

`src/canonical/types.ts` is the single source of truth for what flows through cctra. The shape is intentionally close to **Anthropic Messages** for three reasons:

1. Anthropic is the only one of the three with first-class rich content blocks (text / image / document / tool_use / tool_result / thinking as discriminated union).
2. Anthropic separates `system` from `messages` at the top level — Chat and Responses both bury it as a `role: "system"` message, which would force a round-trip if we picked either of those as the pivot.
3. Anthropic's `tool_use` / `tool_result` pairing is explicit and ordered; OpenAI's `tool_calls` / `tool` messages require maintaining a side index.

The cost of this choice: `CanonicalMessage.role` is a 2-value union (`"user" | "assistant"`) — system is not a message role in canonical, it's a top-level field. The benefit: every other protocol maps cleanly to canonical with no special-casing for system.

### 4.1 `ProtocolExtras` — the forward-compat invariant

This is the single most important architectural invariant in cctra, and the reason it does not drop unknown fields the way some other proxies do (cf. "cc-switch serde drops fields" class of bug):

```ts
export interface ProtocolExtras {
  anthropic?: Record<string, unknown>;
  openaiChat?: Record<string, unknown>;
  openaiResponses?: Record<string, unknown>;
}
```

- **Inbound** — when a client request arrives in Chat / Responses / Anthropic shape, any top-level or per-block / per-message field that cctra's converter doesn't recognize is **preserved verbatim** into the corresponding `extras` bucket, and attached to the canonical message / block it came from. A round-trip `Anthropic → canonical → Anthropic` is bit-identical for every field cctra doesn't know about, including future fields the user might add.
- **Outbound** — when cctra re-emits the request in the upstream protocol, the relevant `extras` bucket is spread back into the wire object via `mergeExtras` (see `src/convert/common/extras.ts`). Unknown fields never silently disappear.
- **Per-level granularity** — `extras` exists on `CanonicalRequest`, `CanonicalMessage`, and on every `CanonicalContentBlock` (`& { extras?: ProtocolExtras }`). A field whose scope is one block stays attached to that block; a top-level field stays at the top.

Two of the 0.5.1 / 0.6.0 / 0.6.1 releases were specifically about closing extras-leak holes (Anthropic `metadata` / `context_management` / `mcp_servers`; Chat `n` / `seed` / `response_format`; Responses `background` / `store` / `prompt_cache_key` / etc.). The pattern is: every new protocol field cctra doesn't natively understand is still preserved; if you see a field cctra strips, that's a bug.

### 4.2 What cctra does not model

- **`previousResponseId` (OpenAI Responses)** — cctra passes it through on `CanonicalRequest` but **does not maintain chain state**. If a client wants the Responses-style multi-turn semantic, it must send the full conversation; cctra is a translator, not a session store.
- **`reasoning.effort` (OpenAI)** and **`thinking.budget_tokens` (Anthropic)** — both are unified into `CanonicalRequest.reasoning: { effort?: "low" | "medium" | "high" }`. cctra does not validate that the upstream protocol supports a given effort level — the upstream rejects what it doesn't accept, and the error is surfaced normally.
- **Vendor-specific refusal semantics** — canonical has a `refusal` block, but it is only emitted when the upstream explicitly returned one. Stop-reason mapping (`"error"` → Anthropic's `"refusal"`) lives in `mapStopReasonToAnthropic` and is the only lossy translation enforced unilaterally by cctra — see [§8](#8-inter-protocol-translation-guarantees).

---

## 5. Request lifecycle

A complete request passes through **eight conversion functions** in the non-streaming case, plus the same eight with their streaming twins in the streaming case. The function-to-file mapping is:

| Direction | Input shape | Output shape | File |
|---|---|---|---|
| inbound | Chat wire | `CanonicalRequest` | `src/convert/inbound/chat-to-canonical.ts` |
| inbound | Responses wire | `CanonicalRequest` | `src/convert/inbound/responses-to-canonical.ts` |
| inbound | Anthropic wire | `CanonicalRequest` | `src/convert/inbound/anthropic-to-canonical.ts` |
| upstream | `CanonicalRequest` | Chat wire | `src/convert/upstream/canonical-to-chat.ts` |
| upstream | `CanonicalRequest` | Anthropic wire | `src/convert/upstream/canonical-to-anthropic.ts` |
| upstream | `CanonicalRequest` | Responses wire | `src/convert/upstream/canonical-to-responses.ts` |
| outbound | `CanonicalResponse` | Chat wire | `src/convert/outbound/canonical-to-chat.ts` |
| outbound | `CanonicalResponse` | Responses wire | `src/convert/outbound/canonical-to-responses.ts` |
| outbound | `CanonicalResponse` | Anthropic wire | `src/convert/outbound/canonical-to-anthropic.ts` |
| streaming-in | wire stream | `AsyncIterable<CanonicalChunk>` | `src/convert/streaming/inbound/{chat,responses,anthropic}-stream.ts` |
| streaming-out | `AsyncIterable<CanonicalChunk>` | wire stream | `src/convert/streaming/outbound/format-{chat,responses,anthropic}.ts` |

The streaming and non-streaming converters are kept **physically separate** (not parameterized) on purpose: streaming conversion has its own state machine (tool-call-id → stable index mapping for Anthropic's `content_block_index`, delta coalescing, finish-reason detection) and mixing it with the non-streaming code path would make both harder to reason about.

### Worked walkthrough: Claude Code → cctra → Anthropic

A user with `ANTHROPIC_BASE_URL=http://127.0.0.1:3133` and `ANTHROPIC_MODEL=cctra-pro` issues a request. Tracing the path:

1. **HTTP arrives at `src/server/serve.ts`** — path matches `POST /v1/messages`, dispatches to `handlers/messages.ts`.
2. **Model resolution (`src/core/resolve.ts`)** — `resolveModelRef("cctra-pro", config)` looks up `config.aliases["cctra-pro"]`, finds `value: "anthropic-main/claude-test"`, splits on `/`, gets `source = providers.anthropic-main` and `modelId = "claude-test"`. If the alias value is `""` (unbound) or the target source doesn't exist, `resolveAlias` throws `ResolveError` with a hint pointing at `cctra switch`.
3. **Inbound conversion (`src/convert/inbound/anthropic-to-canonical.ts`)** — the wire body is parsed into `CanonicalRequest`. Top-level `metadata` and any unknown fields land in `extras.anthropic`. Per-block `cache_control` is attached to the corresponding `CanonicalContentBlock.extras.anthropic`. If the body contains a `redacted_thinking` block, it becomes a canonical `thinking` block with `signature` set and a `[redacted]` text placeholder — this is the 0.5.1 behavior upgrade; earlier versions dropped it.
4. **Upstream conversion (`src/convert/upstream/canonical-to-anthropic.ts`)** — re-emits Anthropic wire. This is mostly structural since the client is also Anthropic-shaped; the only nontrivial step is re-attaching the `extras.anthropic` bucket via `mergeExtras`.
5. **Upstream fetch (`src/server/upstream.ts`)** — `authHeader` and any per-subscription `headers` are merged in, then a `fetch()` is issued. If the source is a plugin in functional mode (`fetch` implemented), the plugin's `fetch` is called instead and the upstream step is skipped.
6. **Response parse (`src/server/anthropic-parser.ts`)** — non-streaming JSON body or streaming SSE events are converted to `CanonicalResponse` or `AsyncIterable<CanonicalChunk>`. `stop_reason: "error"` from a non-Anthropic upstream (e.g., Chat's `content_filter`) is mapped to Anthropic-legal `"refusal"` here, not at outbound time.
7. **Outbound conversion (`src/convert/outbound/canonical-to-anthropic.ts`)** — `CanonicalResponse` → Anthropic wire. Same shape as upstream, so the conversion is also mostly structural.
8. **HTTP response** — the wire is returned with the appropriate `Content-Type`. Streaming responses use `text/event-stream` and the formatter from `src/convert/streaming/outbound/format-anthropic.ts`.

The same path serves `Chat → Anthropic`, `Responses → Chat`, etc. — only steps 1, 3, 5-6, 7, 8 swap to their protocol-specific variants.

---

## 6. Subsystem deep-dives

### 6.1 Core resolution — `src/core/`

This is the runtime's only mandatory path: every request runs `resolveModelRef` before anything else, and the result drives both the inbound → canonical step (for stream-shape decisions) and the upstream step (for protocol choice).

- **`alias.ts`** — auto-alias registration decision. The rule, copied verbatim from the inline comment: when cctra runs `add` or `edit`, if the model id is **unique across all sources, all existing aliases, and the current batch** AND does not collide with a source name, cctra silently writes `aliases[id] = "provider/id"`. Otherwise it does not, and the user must write `provider/model` in full. The function is called once per model registration; for edits the registering source is excluded from the uniqueness check (`excludeSource` parameter).
- **`namespace.ts`** — single-namespace defense. Alias names, provider names, and plugin names all share one namespace. New names must pass kebab-case validation (`/^[a-z0-9][a-z0-9-]{0,62}$/`) and not collide with any existing occupant; the reserved-word list (`add`, `rm`) exists to keep alias names from colliding with commander subcommands. `describeNameOwner` gives a friendly error message pinpointing the conflicting namespace.
- **`resolve.ts`** — `resolveModelRef` with priority: (1) alias table — recursive one-level expansion with `visited` set as defensive cycle detection; (2) `"provider/model"` split; (3) `null`. The `visited` set is theoretically unreachable: `cctra alias` and `cctra switch` both normalize their writes to `"provider/model"` full names, so chains can't form. The defensive check exists for the case of a hand-edited `config.toml` or a future migration that breaks the writer invariant.
- **`model-fetch.ts` / `openrouter-models.ts`** — three-tier model-list cache (memory → disk → network) for sources that need to enumerate their models. Static-config sources (manual `cctra add`) don't go through this path.

### 6.2 Conversion layer — `src/convert/`

Sixteen conversion functions (8 non-streaming + 8 streaming), physically split across four directories by direction: `inbound` (3), `outbound` (3), `upstream` (3), `streaming/{inbound,outbound}` (6). The shared helpers live in `common/`:

- `content-blocks.ts` — text / image / document / tool_use / tool_result / thinking round-trips
- `tool-calls.ts` — tool-call id translation with stable index assignment for Anthropic's `content_block_index`
- `system-prompt.ts` — top-level `system` ↔ `messages[0].role=system` reshape
- `usage.ts` — token count normalization (Anthropic's `input_tokens` / `output_tokens` / `cache_read_input_tokens` ↔ OpenAI's `prompt_tokens` / `completion_tokens` / `prompt_tokens_details.cached_tokens`)
- `reasoning.ts` — Anthropic `thinking` content ignored (only `signature` round-tripped, per the cc-switch `thinking_rectifier` precedent); OpenAI `reasoning_content` preserved into canonical `thinking`
- **`extras.ts`** — `mergeExtras` and the per-protocol split (`splitKnownAndExtras`); the operational expression of the invariant from [§4.1](#41-protocolextras--the-forward-compat-invariant)

The `streaming/` subdirectory is split by **direction** rather than by source protocol because the streaming state machine is largely protocol-specific but the direction (parsing chunks vs. emitting SSE) is the structural axis. The `streaming/inbound/pick.ts` file is a one-liner dispatcher that picks among the three `*-stream.ts` parsers based on `ApiFormat`.

### 6.3 Server — `src/server/`

The HTTP layer is intentionally thin. `serve.ts` is a `Bun.serve()` entry that owns the route table:

| Method + path | Handler |
|---|---|
| `POST /v1/messages` | `handlers/messages.ts` |
| `POST /v1/chat/completions` | `handlers/chat-completions.ts` |
| `POST /v1/responses` | `handlers/responses.ts` |
| `GET /v1/models` | `handlers/models.ts` (aggregates aliases + provider models, exposes `owned_by: "cctra-alias"` for unbound slots) |
| `GET /healthz` | inline |
| `OPTIONS /{path*}` | inline CORS preflight |

Per-request flow: handler extracts body, calls `resolveModelRef`, dispatches to inbound converter, calls upstream (via `upstream.ts` which handles auth header injection and plugin interception), parses response, calls outbound converter, returns.

Auxiliary files worth knowing:

- **`upstream.ts`** — single chokepoint for `fetch()` to upstream. Plugin functional mode (`fetch` / `fetchStream`) is dispatched here; declarative plugins (`getConfig`) fall through to the normal fetch path.
- **`{chat,responses,anthropic}-parser.ts`** — wire → `CanonicalResponse` or `AsyncIterable<CanonicalChunk>`. The Anthropic parser implements the `error → refusal` stop-reason remap so the upstream protocol's error semantics are normalized before outbound.
- **`sse.ts`** + **`keepalive.ts`** — UTF-8-safe SSE event splitter with cross-line `data:` handling and configurable keep-alive ping behavior. The keep-alive exists because some clients / proxies idle-timeout on long completions.
- **`cancelable-fetch.ts`** — wraps the upstream `fetch` so client disconnects (request abort) propagate to upstream, freeing the upstream connection.
- **`error.ts`** + **`error-status.ts`** — two layers: the former is the user-facing error envelope that gets shaped into the client protocol; the latter is the status-code mapping (4xx / 5xx pass-through; cctra-side failures get their own status).

### 6.4 Plugin system — `src/plugin/`

The plugin system exists to let users bring their own auth (OAuth, mTLS, custom headers, session tokens) without cctra ever holding the credentials. cctra does not authenticate to the user's API key, search service, or internal endpoint — the plugin does, and returns a ready-to-call config.

**Trust model v1:** a plugin is **arbitrary JavaScript** that cctra `import()`s on first use. It runs in the cctra process with full filesystem / network / env access. Loading is gated by a confirm-prompt showing the file path and sha256, and the user is expected to verify the checksum against the plugin author's published value. There is no sandbox in v1; `src/plugin/sandbox.ts` exists as a placeholder for a future Worker-isolation hook and is currently empty.

**Two plugin modes:**

- **Declarative** — plugin implements `async getConfig(ctx): UpstreamReady | UpstreamReady[]`. cctra calls it, takes the returned `baseUrl` / `path` / `authHeader` / `apiFormat` / `modelId`, and forwards the request itself. Use this for plugins that just need to mint a token + point cctra at an endpoint.
- **Functional** — plugin implements `async fetch(req, ctx): CanonicalResponse` (or `fetchStream` for streaming). cctra hands the entire canonical request to the plugin and lets it return the canonical response. Use this when the auth algorithm is per-request (token rotation, request signing) or the upstream is not a normal HTTP LLM endpoint.

If both are implemented, declarative wins (cheaper, more cacheable). cctra exposes to plugins a `PluginContext` containing the user-supplied config JSON, a logger (writes to `~/.cctra/daemon.log` with a plugin-name prefix), a wrapped `fetch` with timeouts and UA, and a per-plugin `cacheGet` / `cacheSet` pair for token caching.

**Loader (`src/plugin/loader.ts`):** `import()` with a cache-busting query string (`?t=${Date.now()}`) so reloading a plugin file doesn't hit Node's import cache. Results are memoized in a `Map<path, UpstreamPlugin>`; `clearPluginCache()` is called when the user toggles a plugin's `enabled` state via CLI.

The plugin author contract lives in `src/plugin/contract.ts` and is shipped as `.d.ts` so authors get full IDE type-checking against the latest `UpstreamPlugin` interface.

### 6.5 CLI — `src/commands/`, `src/ui/`, `src/utils/`

`src/index.ts` is the commander entry. Subcommands live in `src/commands/` (one file per command group: `add`, `edit`, `ls`, `show`, `rm`, `rename`, `switch`, `alias`, `plugin`, `serve`). The full command reference is in [README.md § CLI](./README.md#cli) — this section only documents what's not obvious from the command list:

- **UI layer** — `@clack/prompts` for input (validated by `src/ui/prompts.ts` wrappers, which handle ctrl-c cleanly), `picocolors` for output (`src/ui/format.ts` with a Windows Unicode-gap fix), and a hand-rolled `console.table` substitute in `src/ui/table.ts`. The `console-table-printer` dependency was used briefly in 0.4.1 then removed in 0.5.0; cctra now pads columns with `padEnd` and draws section dividers manually.
- **`cctra switch`** is the **only** mutating command that interacts with the running server. The other commands edit `config.toml`; `switch` calls a server-internal `rebroadcast` to flush the in-memory resolver cache. This is what makes hot-reload possible — there's no `restart` step.
- **`src/utils/fuzzy.ts`** powers name completion in `cctra ls` and `cctra show` (the `--filter` argument).

---

## 7. Alias system

Aliases are cctra's only short-name system. They are a single flat `Config.aliases: Record<string, string>` table (not a per-provider map, not a tier hierarchy). The plan file originally proposed a tier system with four preset slots; the current code merged tier and alias into one mechanism because they were isomorphic (both are "short name → provider/model pointer"), and 0.5.0 was the consolidation release.

### What aliases do

- **Preset slots** — `cctra-pro`, `cctra-flash`, `cctra-vision` are seeded on first run as empty slots. The user binds them with `cctra switch`. They can be renamed, deleted, or ignored.
- **Auto-registration** — see [§6.1 alias.ts](#61-core-resolution--srccore). If a model id is unique, cctra silently registers it. If two providers expose the same id (e.g. both Anthropic-main and an OpenAI-compatible mirror have `gpt-4o`), cctra does not auto-register; the user must write `provider/model` in full.
- **Resolution priority** — `aliases[name]` wins over `"provider/model"` split, which wins over a bare id. A bare id that matches no alias and has no `/` is rejected.

### Mutations and their cascades

- **`cctra switch <alias> <target>`** — interactive or non-interactive. Writes `aliases[alias] = "provider/model"` and hot-reloads. If `<target>` is omitted, walks the user through picking one. If `<alias>` is new, confirms creation (namespace defense) and then prompts for target.
- **`cctra rm <provider|plugin>`** — for any alias whose value points into the deleted source, sets `aliases[k] = ""` (unbound) rather than deleting the slot. The slot is preserved because the user may want to rebind it.
- **`cctra rename <old> <new>`** — for any alias whose value starts with `old/`, rewrites the prefix to `new/`. Slot is preserved.

### Reserved words

`add` and `rm` cannot be alias names — they collide with commander subcommands. The CLI rejects them at creation time via the same kebab-case + namespace validation path as any other name.

### Hot-reload mechanism

`cctra switch` does not restart the server. The CLI writes the new config, the in-memory resolver picks it up on the next request. This is what makes "alias in client config" a viable workflow: the user picks a stable name (`cctra-pro`), configures their client with it, and changes the underlying provider/model without touching client config.

---

## 8. Inter-protocol translation guarantees

This section lists what cctra **guarantees** about round-trips. The list of known lossy translations is in [README.md § Client integration → Known inter-protocol incompatibilities](./README.md#client-integration) — that list grows when we discover a new lossy case; this section is what stays stable.

**Always preserved:**

- **Unknown top-level / per-message / per-block fields** — every protocol's extras bucket is preserved through canonical and re-spread on outbound. If you find a field that gets dropped, that's a bug. (See [§4.1](#41-protocolextras--the-forward-compat-invariant).)
- **Unknown block / part / item types** — never silently dropped. As of 0.5.1 (Anthropic) and 0.6.0 (Chat, Responses), unknown variants become a `text` block with content `[unknown_X:<type>]` plus the original payload in `extras`. Round-trip is preserved; semantic interpretation is not.
- **`cache_control` on all six block types** + on `system` array entries (Anthropic). Critical for prompt caching.
- **`signature` on Anthropic `thinking` blocks** — round-tripped. The `thinking` text itself is not consumed (it's the model's private reasoning); the signature is what the upstream needs to accept the block in subsequent turns.
- **`reasoning_content` (OpenAI)** — preserved into a canonical `thinking` block on inbound, re-emitted in the upstream protocol that supports it.
- **Tool-call id mapping** — `toolu_01xxx` ↔ `call_xxx` translated per turn, with a stable `HashMap<tool_call_id, u32>` keeping Anthropic's `content_block_index` stable across streaming.

**Lossy in known ways (documented in README, not here):**

- 8 interop incompatibilities in the README list — image re-encoding, `document` blocks on non-Anthropic, refusal semantics, `stop_reason: "error"` → `"refusal"` on Anthropic outbound, system `cache_control` flattening on Chat, etc. These are inherent to the protocol differences, not bugs to fix.

**Enforced unilaterally by cctra:**

- `stop_reason: "error"` → `"refusal"` (Anthropic) — see [README.md known incompatibilities](./README.md#client-integration). Implemented in `mapStopReasonToAnthropic`, shared between non-streaming and streaming paths.

---

## 9. Testing architecture

`tests/` has **six unit test files** + **one integration test** with an in-process mock upstream.

```
tests/
├── providers-presets.test.ts   # vendor preset registry shape
├── alias.test.ts               # auto-alias rules + namespace defense
├── migrate.test.ts             # config schema migrations (subscription→provider, etc.)
├── switch.test.ts              # cctra switch + alias binding
├── convert.test.ts             # all 16 conversion functions, fixture-driven
├── server.test.ts              # end-to-end HTTP server, hits mock upstream
└── integration/
    └── mock-upstream.ts        # in-process fake upstream (echo / chatEcho / anthropicEcho)
```

- **Unit tests** use fixture JSON: a representative input and the expected canonical / wire output. `convert.test.ts` is the largest by far (~half the test count) and covers all 16 functions including the streaming versions with SSE event fixtures.
- **Integration tests** spin up `src/server/serve.ts`, point a configured `Config` at `tests/integration/mock-upstream.ts`, and issue real HTTP requests in all 9 protocol combinations (3 client protocols × 3 upstream protocols) since 0.6.1. They assert on happy-path 200 + key fields + echo content match; streaming is covered in unit tests only.
- **Test isolation** — the integration tests use `CCTRA_CONFIG` env var + `mkdtempSync` to give each test a private `~/.cctra/` working directory. They do **not** mutate the user's real config.

### Known engineering debt (not a TODO)

The integration tests use a hard-coded port (`31444`). Concurrent test runs would collide. The reason it's hard-coded and not `startServer(0)` (random port): doing so would invalidate the `tests/integration/mock-upstream.ts` cross-process wiring. This is documented in [TODO.md § 已知工程债](./TODO.md) and explicitly marked "不算 TODO" — a personal project rarely runs tests concurrently.

---

## 10. Operational notes

**Network binding.** cctra listens on `127.0.0.1:3133` only. It is **not** intended to be exposed to a LAN; there is no auth, no rate limit, no body-size limit. Localhost-only is the threat model.

**Config paths.**

- `~/.cctra/config.toml` — the only persisted config. TOML, edited by the CLI, serialized via [confbox](https://github.com/unjs/confbox). Schema migrations run on every load (see `tests/migrate.test.ts` for the migration test suite).
- `~/.cctra/plugins/<name>/config.json` — per-plugin user config (the JSON the user fills in the `cctra plugin add` wizard). Kept separate so plugin config can be edited / version-controlled independently.
- `~/.cctra/daemon.log` — log file (used by plugin `logger` and server keepalive diagnostics; not the CLI's stdout).

**Hot-reload.** Aliases and provider config edits made via the CLI take effect on the next request without a server restart. There is no `cctra reload` command and no signal handler — the resolver reads `config.toml` lazily per request (or per `cctra switch`, which forces a refresh).

**Foreground vs background.** `cctra serve` is the only way to run the server. There is **no** `cctra daemon install` / systemd unit / LaunchAgent / Windows Task Scheduler integration in v1. The plan file describes what such integration would look like (Rust launcher with `CREATE_NO_WINDOW` on Windows, `~/Library/LaunchAgents` plist on macOS, `~/.config/systemd/user/` unit on Linux), but none of it is implemented and the code paths (`src/plugin/sandbox.ts`, `src/daemon/`) do not exist. If you need persistent backgrounding, use whatever supervisor your OS ships with — the server is a normal foreground process.

**Streaming keepalive.** Long completions can idle-timeout on aggressive proxies. `src/server/keepalive.ts` emits periodic SSE comment lines to keep the connection warm. This is per-handler; no global config.

**Versioning.** Schema-breaking changes (e.g. `subscription` → `provider` in 0.4.0, `Model.alias` → `Config.aliases` in 0.5.0) ship with a migration step in `src/core/migrate.ts` that runs on every config load. The migration is idempotent — running it on a post-migration config is a no-op.

---

## 11. See also

- **[README.md](./README.md)** — installation, quick start, full CLI reference, client integration (Claude Code / Codex / generic OpenAI-SDK), known inter-protocol incompatibilities, plugin authoring examples
- **[CLAUDE.md](./CLAUDE.md)** — agent-facing project instructions (conventions, file layout, baseURL expectations)
- **[TODO.md](./TODO.md)** — current state, decision archive, P3 backlog, the M.5 design principles and their case-law table
- **Design plan** — `C:\Users\Admin\.claude\plans\happy-growing-fairy.md` (the original design document; reflects the planned state, not necessarily the current code — drift is documented inline above)
