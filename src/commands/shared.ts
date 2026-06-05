// ============================================================================
// 共享工具：读/写 config 的 helper
// ============================================================================
import { loadConfigFile, saveConfigFile } from "../core/config";
import { ensureCctraDir } from "../utils/paths";
import type { Config } from "../types";

export function withConfig<T>(fn: (config: Config) => T): T {
  ensureCctraDir();
  const config = loadConfigFile();
  const result = fn(config);
  saveConfigFile(config);
  return result;
}
