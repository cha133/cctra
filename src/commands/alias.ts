// ============================================================================
// cctra alias <model> [<new-alias>]：查 / 设 / 清 model alias
// ============================================================================
import { Command } from "commander";
import { withConfig } from "./shared";
import { resolveModelRef, ResolveError } from "../core/resolve";
import { getSource } from "../core/source";
import { success, error as errorOut, info, dim } from "../ui/format";
import type { Config, Model, Provider, PluginConfig } from "../types";

export function registerAlias(program: Command): void {
  program
    .command("alias <model> [newAlias]")
    .description("Show, set, or clear a model alias")
    .option("--clear", "Clear the alias")
    .action(async (model: string, newAlias: string | undefined, opts: { clear?: boolean }) => {
      try {
        if (newAlias && opts.clear) {
          errorOut("Cannot both set and clear alias.");
          process.exit(1);
        }

        if (newAlias) {
          setAlias(model, newAlias);
        } else if (opts.clear) {
          setAlias(model, "");
        } else {
          showAlias(model);
        }
      } catch (e) {
        if (e instanceof ResolveError || (e as Error).message.includes("not found")) {
          errorOut((e as Error).message);
          process.exit(1);
        }
        throw e;
      }
    });
}

function showAlias(ref: string): void {
  withConfig((config) => {
    const resolved = resolveModelRef(ref, config);
    if (!resolved) {
      info(`Model "${ref}" not found.`);
      return;
    }
    const m = findModel(resolved.source.models, resolved.modelId);
    if (!m) {
      info(`Model "${ref}" not found.`);
      return;
    }
    if (m.alias) {
      console.log(m.alias);
    } else {
      console.log(dim("(none)"));
    }
  });
}

function setAlias(ref: string, newAlias: string): void {
  const trimmed = newAlias.trim();

  // 解析模型引用为 provider/model
  withConfig((config) => {
    const parts = parseProviderModel(ref, config);
    if (!parts) {
      errorOut(`Could not resolve "${ref}" to a specific model. Use \`provider/model\` format for unambiguous setting.`);
      process.exit(1);
    }

    const { providerName, modelId } = parts;
    const s = getSource(config, providerName);
    if (!s) {
      errorOut(`Provider "${providerName}" not found.`);
      process.exit(1);
    }

    const m = s.models.find((model) => model.id === modelId);
    if (!m) {
      errorOut(`Model "${modelId}" not found in provider "${providerName}".`);
      process.exit(1);
    }

    if (trimmed) {
      m.alias = trimmed;
      success(`Alias "${trimmed}" set for "${providerName}/${modelId}".`);
    } else {
      m.alias = undefined;
      success(`Alias cleared for "${providerName}/${modelId}".`);
    }
    (s as Provider).updatedAt = Date.now();
  });
}

/** 把 ref 解析为 { providerName, modelId } */
function parseProviderModel(ref: string, config: Config): { providerName: string; modelId: string } | null {
  // 1. provider/model 格式
  if (ref.includes("/")) {
    const [name, modelPart] = ref.split("/", 2);
    if (!name || !modelPart) return null;
    const source = getSource(config, name);
    if (!source) return null;
    const m = findModel(source.models, modelPart);
    if (m) return { providerName: name, modelId: m.id };
    return null;
  }

  // 2. 全局 alias 解析
  try {
    const resolved = resolveModelRef(ref, config);
    if (resolved) {
      return { providerName: resolved.source.name, modelId: resolved.modelId };
    }
  } catch {
    // 歧义
  }

  return null;
}

function findModel(models: Model[], ref: string): Model | null {
  return models.find((m) => m.id === ref || m.alias === ref) ?? null;
}
