// ============================================================================
// 状态查询：探测端口 /healthz
// ============================================================================
import { loadConfigFile } from "../core/config";

export async function checkDaemonStatus(): Promise<{ running: boolean; port: number }> {
  const config = loadConfigFile();
  const port = config.port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json() as { ok: boolean };
      return { running: data.ok === true, port };
    }
    return { running: false, port };
  } catch {
    return { running: false, port };
  }
}
