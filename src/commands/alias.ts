// ============================================================================
// cctra alias [name] [target]   — show / set / list aliases
// cctra alias add <name>        — 创建 unbound 槽位
// cctra alias rm <name>         — 删 alias
// ============================================================================
import { Command } from "commander";
import { withConfig } from "./shared";
import { resolveModelRef, ResolveError } from "../core/resolve";
import {
  describeNameOwner,
  isValidAliasName,
  nameTakenAnywhere,
} from "../core/namespace";
import {
  success,
  error as errorOut,
  info,
  dim,
  green,
  cyan,
} from "../ui/format";

/** alias 子命令名，禁止占用为 alias name（避免 commander 路由歧义） */
const RESERVED_SUBCOMMANDS = new Set(["add", "rm"]);

export function registerAlias(program: Command): void {
  const alias = program
    .command("alias [name] [target]")
    .description("Show, set, or list aliases (run with no args to list all)")
    .action((name?: string, target?: string) => {
      if (!name) return showList();
      if (target === undefined) return showOne(name);
      return setAlias(name, target);
    });

  alias
    .command("add <name>")
    .description("Create an empty (unbound) alias slot")
    .action((name: string) => addEmpty(name));

  alias
    .command("rm <name>")
    .description("Remove an alias")
    .action((name: string) => removeAlias(name));
}

// ---------------------------------------------------------------------------

function showList(): void {
  withConfig((config) => {
    const entries = Object.entries(config.aliases).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    if (entries.length === 0) {
      info("No aliases configured.");
      return;
    }
    const maxName = Math.max(...entries.map(([n]) => n.length));
    for (const [name, value] of entries) {
      const padded = green(name.padEnd(maxName));
      const tail = value
        ? `${dim(cyan("→"))} ${value}`
        : dim("(unbound)");
      console.log(`  ${padded}  ${tail}`);
    }
  });
}

function showOne(name: string): void {
  withConfig((config) => {
    const value = config.aliases[name];
    if (value === undefined) {
      errorOut(`Alias "${name}" not found.`);
      process.exit(1);
    }
    console.log(value || dim("(unbound)"));
  });
}

function setAlias(name: string, target: string): void {
  const trimmed = target.trim();
  withConfig((config) => {
    // 解析 target → 全名（不接受 ""，清空请改配置文件）
    let resolved;
    try {
      resolved = resolveModelRef(trimmed, config);
    } catch (e) {
      if (e instanceof ResolveError) {
        errorOut(e.message);
        process.exit(1);
      }
      throw e;
    }
    if (!resolved) {
      errorOut(
        `Target "${trimmed}" does not resolve to a known model. Use \`cctra ls\` to see available models.`,
      );
      process.exit(1);
    }
    const fullName = `${resolved.source.name}/${resolved.modelId}`;

    // 已存在 alias → 直接 update
    if (config.aliases[name] !== undefined) {
      if (config.aliases[name] === fullName) {
        info(`Alias "${name}" already points to ${fullName}. No change.`);
        return;
      }
      config.aliases[name] = fullName;
      success(`Alias "${name}" → ${fullName}`);
      return;
    }

    // 不存在 → auto-add；先校验
    assertCanCreateAlias(config, name);
    config.aliases[name] = fullName;
    success(`Created alias "${name}" → ${fullName}`);
  });
}

function addEmpty(name: string): void {
  withConfig((config) => {
    assertCanCreateAlias(config, name);
    config.aliases[name] = "";
    success(
      `Created empty alias "${name}". Bind it with \`cctra switch ${name} <provider>/<model>\`.`,
    );
  });
}

function removeAlias(name: string): void {
  withConfig((config) => {
    if (config.aliases[name] === undefined) {
      errorOut(`Alias "${name}" not found.`);
      process.exit(1);
    }
    delete config.aliases[name];
    success(`Removed alias "${name}".`);
  });
}

// ---------------------------------------------------------------------------

/** 创建新 alias 前的统一校验：命名 + 保留字 + 跨 namespace 冲突 */
function assertCanCreateAlias(config: { providers: Record<string, unknown>; plugins: Record<string, unknown>; aliases: Record<string, string> }, name: string): void {
  if (!isValidAliasName(name)) {
    errorOut(
      `Invalid alias name "${name}". Must be kebab-case, 1-63 chars (lowercase letters/digits/hyphens).`,
    );
    process.exit(1);
  }
  if (RESERVED_SUBCOMMANDS.has(name)) {
    errorOut(
      `"${name}" conflicts with a reserved subcommand name. Pick another.`,
    );
    process.exit(1);
  }
  // nameTakenAnywhere 会捕到 source 名冲突；alias 重名留给上层 setAlias 区分
  if (nameTakenAnywhere(config as Parameters<typeof nameTakenAnywhere>[0], name)) {
    const owner = describeNameOwner(
      config as Parameters<typeof describeNameOwner>[0],
      name,
    );
    errorOut(`Name "${name}" is already in use as ${owner}.`);
    process.exit(1);
  }
}
