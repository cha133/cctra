// ============================================================================
// cctra test：API 端点探测（协议检测 + 模型列表）
// ============================================================================
import { Command } from "commander";
import { joinUrl, stripCompatSuffix, stripProbePath } from "../core/model-fetch";
import { bold, dim, green, red, yellow } from "../ui/format";
import { padEndStr, printSection } from "../ui/table";

const TIMEOUT_MS = 5000;

interface ProbeResult {
  api: string;
  ok: boolean;
  httpStatus: number; // 0 = network error
  detail?: string;
  probePath?: string; // 探测打过的 URL；多候选失败时为逗号分隔的尝试列表
}

interface ModelsProbeResult extends ProbeResult {
  models: string[];
}

export function registerTest(program: Command): void {
  program
    .command("test <url> <key>")
    .description("Probe an endpoint for supported APIs and available models")
    .option("-m, --model <model>", "Model to use for API probe requests")
    .action(async (url: string, key: string, opts: { model?: string }) => {
      const base = normalizeURL(url);
      const root = stripProbePath(base);
      const headers = buildHeaders(key);

      console.log(`${bold("Probing")} ${dim(base)} ...\n`);

      // 1. 先探 models（需要它的结果来选探针模型）
      const modelsResult = await probeModels(root, headers);

      // 2. 决定探针用的模型名
      const probeModel =
        opts.model ??
        (modelsResult.models.length > 0 ? modelsResult.models[0]! : "__cctra_probe__");

      // 3. 并发探 3 个 API 协议
      const [anthropic, chat, responses] = await Promise.all([
        probeAnthropic(root, headers, probeModel),
        probeChat(root, headers, probeModel),
        probeResponses(root, headers, probeModel),
      ]);

      // 4. 渲染结果
      const results: ProbeResult[] = [
        { api: "Anthropic Messages", ...anthropic },
        { api: "OpenAI Chat", ...chat },
        { api: "OpenAI Responses", ...responses },
        {
          api: `Models${modelsResult.ok ? ` (${modelsResult.models.length} models)` : ""}`,
          ok: modelsResult.ok,
          httpStatus: modelsResult.httpStatus,
          detail: modelsResult.detail,
          probePath: modelsResult.probePath,
        },
      ];

      printResults(results);

      // 5. 列出模型
      if (modelsResult.models.length > 0) {
        const label = modelCountLabel(modelsResult.models.length);
        const show = modelsResult.models.slice(0, 20);
        const rows = show.map((m) => dim(`• ${m}`));
        if (modelsResult.models.length > 20) {
          rows.push(dim(`  ... and ${modelsResult.models.length - 20} more`));
        }
        console.log();
        printSection(label, rows);
      }
    });
}

// ---------------------------------------------------------------------------
// 探测函数
// ---------------------------------------------------------------------------

async function probeModels(base: string, headers: Record<string, string>): Promise<ModelsProbeResult> {
  const url = joinUrl(base, "/v1/models");
  let result = await tryProbeModels(url, headers);
  if (result.models.length > 0) return { ...result, probePath: url };

  const stripped = stripCompatSuffix(base);
  if (stripped) {
    const fallbackUrl = joinUrl(stripped, "/v1/models");
    if (fallbackUrl !== url) {
      result = await tryProbeModels(fallbackUrl, headers);
      if (result.models.length > 0) {
        return { ...result, detail: `retried at ${fallbackUrl}`, probePath: fallbackUrl };
      }
    }
  }

  return { ...result, probePath: url };
}

async function tryProbeModels(url: string, headers: Record<string, string>): Promise<ModelsProbeResult> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.json().catch(() => null);
    if (body && Array.isArray((body as Record<string, unknown>).data)) {
      const models = ((body as Record<string, unknown>).data as Array<{ id: string }>).map((m) => m.id);
      return { api: "Models", ok: true, httpStatus: res.status, models };
    }
    const reason = body ? `unexpected response shape` : `non-JSON response`;
    return { api: "Models", ok: false, httpStatus: res.status, detail: reason, models: [] };
  } catch {
    return { api: "Models", ok: false, httpStatus: 0, detail: "connection failed or timeout", models: [] };
  }
}

async function probeAnthropic(
  base: string,
  headers: Record<string, string>,
  model: string,
): Promise<Omit<ProbeResult, "api">> {
  // Anthropic 协议两个候选 URL：标准 /v1/messages + 子前缀 /anthropic/v1/messages
  // 并发探第一个命中即返回（外层 Promise.all 仍只看到 1 个 promise）
  const urls = [
    joinUrl(base, "/v1/messages"),
    joinUrl(base, "/anthropic/v1/messages"),
  ];
  const results = await Promise.all(
    urls.map(async (url) => ({ url, r: await tryProbeAnthropicOne(url, headers, model) })),
  );
  const hit = results.find(({ r }) => r.ok);
  if (hit) return { ...hit.r, probePath: hit.url };
  // 全失败：probePath 列出全部尝试过的，detail 仍取第一个 URL 的
  return { ...results[0]!.r, probePath: urls.join(", ") };
}

async function tryProbeAnthropicOne(
  url: string,
  headers: Record<string, string>,
  model: string,
): Promise<Omit<ProbeResult, "api" | "probePath">> {
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 1,
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== "object") {
      return { ok: false, httpStatus: res.status, detail: "non-JSON response" };
    }
    const json = raw as Record<string, unknown>;
    if (json.type === "message" || json.type === "error") {
      return { ok: true, httpStatus: res.status };
    }
    return { ok: false, httpStatus: res.status, detail: "wrong shape" };
  } catch {
    return { ok: false, httpStatus: 0, detail: "connection failed or timeout" };
  }
}

async function probeChat(
  base: string,
  headers: Record<string, string>,
  model: string,
): Promise<Omit<ProbeResult, "api">> {
  const url = joinUrl(base, "/v1/chat/completions");
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 1,
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== "object") {
      return { ok: false, httpStatus: res.status, detail: "non-JSON response", probePath: url };
    }
    const json = raw as Record<string, unknown>;
    if (Array.isArray(json.choices)) {
      return { ok: true, httpStatus: res.status, probePath: url };
    }
    if (json.error && typeof json.error === "object" && typeof (json.error as Record<string, unknown>).message === "string") {
      return { ok: true, httpStatus: res.status, probePath: url };
    }
    return { ok: false, httpStatus: res.status, detail: "wrong shape", probePath: url };
  } catch {
    return { ok: false, httpStatus: 0, detail: "connection failed or timeout", probePath: url };
  }
}

async function probeResponses(
  base: string,
  headers: Record<string, string>,
  model: string,
): Promise<Omit<ProbeResult, "api">> {
  const url = joinUrl(base, "/v1/responses");
  const body = JSON.stringify({
    model,
    input: "hi",
    max_output_tokens: 1,
  });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = await res.json().catch(() => null);
    if (!raw || typeof raw !== "object") {
      return { ok: false, httpStatus: res.status, detail: "non-JSON response", probePath: url };
    }
    const json = raw as Record<string, unknown>;
    if (Array.isArray(json.output)) {
      return { ok: true, httpStatus: res.status, probePath: url };
    }
    if (json.error && typeof json.error === "object") {
      const e = json.error as Record<string, unknown>;
      if (typeof e.message === "string" || typeof e.code === "string") {
        return { ok: true, httpStatus: res.status, probePath: url };
      }
    }
    return { ok: false, httpStatus: res.status, detail: "wrong shape", probePath: url };
  } catch {
    return { ok: false, httpStatus: 0, detail: "connection failed or timeout", probePath: url };
  }
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

function printResults(results: ProbeResult[]): void {
  const labelW = Math.max(...results.map((r) => r.api.length));
  for (const r of results) {
    const icon = r.ok ? green("✔") : red("✖");
    const tail = formatStatusTail(r);
    console.log(`  ${padEndStr(r.api, labelW)}  ${icon}${tail}`);
  }
}

/** status / detail 后缀：HTTP 状态码 + detail（如果有） + probePath（始终展示，剥 scheme+host） */
function formatStatusTail(r: ProbeResult): string {
  const parts: string[] = [];
  // 异常 HTTP 状态（非 2xx，非 0=连接失败）
  if (r.httpStatus > 0 && (r.httpStatus < 200 || r.httpStatus >= 300)) {
    parts.push(yellow(`HTTP ${r.httpStatus}`));
  }
  if (r.detail) {
    parts.push(dim(r.detail));
  }
  if (r.probePath) {
    parts.push(dim(toPathOnly(r.probePath)));
  }
  return parts.length > 0 ? `  (${parts.join(", ")})` : "";
}

function modelCountLabel(count: number): string {
  return count === 1 ? "1 model" : `${count} models`;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function normalizeURL(url: string): string {
  return url.replace(/\/+$/, "");
}

function buildHeaders(key: string): Record<string, string> {
  const token = key.startsWith("Bearer ") ? key : `Bearer ${key}`;
  return { Authorization: token };
}

/** 从完整 URL 里只取 pathname（剥 scheme + host）。非完整 URL 时原样返回 */
function toPathOnly(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
