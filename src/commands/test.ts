// ============================================================================
// cctra test：API 端点探测（协议检测 + 模型列表）
// ============================================================================
import { Command } from "commander";
import { joinUrl, stripCompatSuffix } from "../core/model-fetch";
import { bold, dim, green, red } from "../ui/format";
import { padEndStr } from "../ui/table";

const TIMEOUT_MS = 5000;

interface ProbeResult {
  api: string;
  ok: boolean;
  detail?: string;
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
      const headers = buildHeaders(key);

      console.log(`${bold("Probing")} ${dim(base)} ...\n`);

      // 1. 先探 models（需要它的结果来选探针模型）
      const modelsResult = await probeModels(base, headers);

      // 2. 决定探针用的模型名
      const probeModel =
        opts.model ??
        (modelsResult.models.length > 0 ? modelsResult.models[0]! : "gpt-3.5-turbo");

      // 3. 并发探 3 个 API 协议
      const [anthropic, chat, responses] = await Promise.all([
        probeAnthropic(base, headers, probeModel),
        probeChat(base, headers, probeModel),
        probeResponses(base, headers, probeModel),
      ]);

      // 4. 渲染结果
      const results: ProbeResult[] = [
        { api: "Anthropic Messages", ...anthropic },
        { api: "OpenAI Chat", ...chat },
        { api: "OpenAI Responses", ...responses },
        {
          api: `Models${modelsResult.ok ? ` (${modelsResult.models.length} models)` : ""}`,
          ok: modelsResult.ok,
          detail: modelsResult.detail,
        },
      ];

      printResults(results);

      // 5. 列出模型
      if (modelsResult.models.length > 0) {
        console.log();
        const show = modelsResult.models.slice(0, 20);
        for (const m of show) {
          console.log(`  ${dim("•")} ${m}`);
        }
        if (modelsResult.models.length > 20) {
          console.log(`  ${dim(`... and ${modelsResult.models.length - 20} more`)}`);
        }
      }
    });
}

// ---------------------------------------------------------------------------
// 探测函数
// ---------------------------------------------------------------------------

async function probeModels(base: string, headers: Record<string, string>): Promise<ModelsProbeResult> {
  // 先试主 URL
  const url = joinUrl(base, "/v1/models");
  let result = await tryProbeModels(url, headers);
  if (result.models.length > 0) return result;

  // 剥离已知兼容后缀重试
  const stripped = stripCompatSuffix(base);
  if (stripped) {
    const fallbackUrl = joinUrl(stripped, "/v1/models");
    if (fallbackUrl !== url) {
      result = await tryProbeModels(fallbackUrl, headers);
      if (result.models.length > 0) return { ...result, detail: `retried at ${fallbackUrl}` };
    }
  }

  return result;
}

async function tryProbeModels(url: string, headers: Record<string, string>): Promise<ModelsProbeResult> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.json().catch(() => null);
    if (body && Array.isArray((body as Record<string, unknown>).data)) {
      const models = ((body as Record<string, unknown>).data as Array<{ id: string }>).map((m) => m.id);
      return { api: "Models", ok: true, models };
    }
    const reason = body ? `unexpected response shape (HTTP ${res.status})` : `non-JSON response (HTTP ${res.status})`;
    return { api: "Models", ok: false, detail: reason, models: [] };
  } catch {
    return { api: "Models", ok: false, detail: "connection failed or timeout", models: [] };
  }
}

async function probeAnthropic(
  base: string,
  headers: Record<string, string>,
  model: string,
): Promise<Omit<ProbeResult, "api">> {
  const url = joinUrl(base, "/v1/messages");
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
      return { ok: false, detail: "non-JSON response" };
    }
    const json = raw as Record<string, unknown>;
    // Anthropic 特征：成功响应有 type === "message"，错误响应有 type === "error"
    if (json.type === "message" || json.type === "error") {
      return { ok: true };
    }
    // 有些 provider 在 /v1/messages 返回 OpenAI 风格错误 → 不认
    return { ok: false, detail: `response doesn't match Anthropic protocol (HTTP ${res.status})` };
  } catch {
    return { ok: false, detail: "connection failed or timeout" };
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
      return { ok: false, detail: "non-JSON response" };
    }
    const json = raw as Record<string, unknown>;
    // Chat 特征：成功有 choices 数组，错误有顶层 error.message
    if (Array.isArray(json.choices)) {
      return { ok: true };
    }
    if (json.error && typeof json.error === "object" && typeof (json.error as Record<string, unknown>).message === "string") {
      return { ok: true };
    }
    return { ok: false, detail: `response doesn't match Chat protocol (HTTP ${res.status})` };
  } catch {
    return { ok: false, detail: "connection failed or timeout" };
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
      return { ok: false, detail: "non-JSON response" };
    }
    const json = raw as Record<string, unknown>;
    // Responses 特征：成功有 output 数组，错误有顶层 error.code 或 error.message
    if (Array.isArray(json.output)) {
      return { ok: true };
    }
    if (json.error && typeof json.error === "object") {
      const e = json.error as Record<string, unknown>;
      if (typeof e.message === "string" || typeof e.code === "string") {
        return { ok: true };
      }
    }
    return { ok: false, detail: `response doesn't match Responses protocol (HTTP ${res.status})` };
  } catch {
    return { ok: false, detail: "connection failed or timeout" };
  }
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

function printResults(results: ProbeResult[]): void {
  const labelW = Math.max(...results.map((r) => r.api.length));
  const pad = labelW + 4;

  // 表头
  const sep = "─".repeat(pad + 8);
  console.log(`┌${sep}┐`);
  console.log(`│ ${bold(padEndStr("API", pad))} │ ${bold("Status")} │`);
  console.log(`├${sep}┤`);

  for (const r of results) {
    const status = r.ok ? green("✔") : red("✖");
    const detail = r.detail ? dim(` (${r.detail})`) : "";
    console.log(`│ ${padEndStr(r.api, pad)} │ ${status}     │${detail}`);
  }

  console.log(`└${sep}┘`);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function normalizeURL(url: string): string {
  return url.replace(/\/+$/, "");
}

function buildHeaders(key: string): Record<string, string> {
  // 自动补 Bearer 前缀
  const token = key.startsWith("Bearer ") ? key : `Bearer ${key}`;
  return { Authorization: token };
}
