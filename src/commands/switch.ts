// ============================================================================
// cctra switch [name] [target]
// 交互式 / 非交互式切换 alias 指向。
//
// - 无参：prompts 选 alias，prompts 选 model
// - 只给 name：alias 存在则 prompts 选 model；不存在则 confirm 创建后 prompts 选
// - 给齐 name + target：直接 set/create-then-set
// ============================================================================
import { Command } from "commander";
import * as p from "@clack/prompts";
import { withConfig } from "./shared";
import { resolveModelRef, ResolveError } from "../core/resolve";
import {
  describeNameOwner,
  isValidAliasName,
  nameTakenAnywhere,
} from "../core/namespace";
import { loadConfigFile } from "../core/config";
import { checkCancel } from "../ui/prompts";
import { success, error as errorOut, info, dim } from "../ui/format";
import type { Config } from "../types";

/** alias 子命令保留字，禁止占用为 alias name */
const RESERVED_SUBCOMMANDS = new Set(["add", "rm"]);

export function registerSwitch(program: Command): void {
  program
    .command("switch [name] [target]")
    .description(
      "Switch an alias's binding. Interactive (prompts) when args omitted.",
    )
    .action(async (name?: string, target?: string) => {
      // 1. 决定要操作哪个 alias
      const config = loadConfigFile();
      const aliasName = name ?? (await pickAliasInteractive(config));

      // 2. alias 不存在 → 确认创建
      const exists = config.aliases[aliasName] !== undefined;
      if (!exists) {
        const create = await p.confirm({
          message: `Alias "${aliasName}" doesn't exist. Create it?`,
          initialValue: true,
        });
        if (!checkCancel(create)) process.exit(0);
        assertCanCreateAlias(config, aliasName);
      }

      // 3. 决定 target
      const aliasTarget =
        target ??
        (await pickModelInteractive(
          config,
          exists
            ? `Switch alias "${aliasName}" to:`
            : `Bind new alias "${aliasName}" to:`,
        ));

      // 4. 写入
      doSwitch(aliasName, aliasTarget, !exists);
    });
}

// ---------------------------------------------------------------------------

async function pickAliasInteractive(config: Config): Promise<string> {
  const entries = Object.entries(config.aliases).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (entries.length === 0) {
    errorOut(
      "No aliases configured yet. Use `cctra alias add <name>` first.",
    );
    process.exit(1);
  }
  const options = entries.map(([name, value]) => ({
    value: name,
    label: name,
    hint: value || "unbound",
  }));
  return checkCancel(
    await p.select({
      message: "Switch which alias?",
      options,
    }),
  ) as string;
}

async function pickModelInteractive(
  config: Config,
  message: string,
): Promise<string> {
  const options: Array<{ value: string; label: string }> = [];
  for (const [sname, src] of Object.entries(config.providers)) {
    for (const m of src.models) {
      options.push({
        value: `${sname}/${m.id}`,
        label: `${sname}/${m.id}`,
      });
    }
  }
  for (const [sname, plug] of Object.entries(config.plugins)) {
    if (!plug.enabled) continue;
    for (const m of plug.models) {
      options.push({
        value: `${sname}/${m.id}`,
        label: `${sname}/${m.id}`,
      });
    }
  }
  if (options.length === 0) {
    errorOut("No models configured. Run `cctra add` first.");
    process.exit(1);
  }
  options.sort((a, b) => a.label.localeCompare(b.label));
  return checkCancel(
    await p.select({
      message,
      options,
    }),
  ) as string;
}

function doSwitch(name: string, target: string, isNew: boolean): void {
  const trimmed = target.trim();
  if (!trimmed) {
    errorOut(
      "Empty target. To clear an alias, edit `~/.config/cctra/config.toml` directly.",
    );
    process.exit(1);
  }
  withConfig((config) => {
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

    if (!isNew && config.aliases[name] === fullName) {
      info(`Alias "${name}" already points to ${fullName}. No change.`);
      return;
    }

    if (isNew) {
      // 二次校验（config 可能在 prompts 期间被改）
      assertCanCreateAlias(config, name);
    }

    config.aliases[name] = fullName;
    success(
      isNew
        ? `Created alias "${name}" ${dim("→")} ${fullName}`
        : `Alias "${name}" ${dim("→")} ${fullName}`,
    );
  });
}

/**
 * Test 友好的纯函数版：不走 process.exit，错误用 throw 表达。
 * 对应 `cctra switch <name> <target>` 的非交互路径。
 */
export function switchAliasOrThrow(
  name: string,
  target: string,
  isNew: boolean,
): void {
  const trimmed = target.trim();
  if (!trimmed) throw new Error("Empty target.");
  withConfig((config) => {
    const resolved = resolveModelRef(trimmed, config);
    if (!resolved) throw new Error(`Target "${trimmed}" does not resolve.`);
    const fullName = `${resolved.source.name}/${resolved.modelId}`;
    if (!isNew && config.aliases[name] === fullName) return; // no-op
    if (isNew) {
      if (!isValidAliasName(name)) throw new Error(`Invalid alias name "${name}".`);
      if (RESERVED_SUBCOMMANDS.has(name)) throw new Error(`Reserved: "${name}".`);
      if (nameTakenAnywhere(config, name)) {
        throw new Error(`Name "${name}" already in use as ${describeNameOwner(config, name)}.`);
      }
    }
    config.aliases[name] = fullName;
  });
}

function assertCanCreateAlias(config: Config, name: string): void {
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
  if (nameTakenAnywhere(config, name)) {
    const owner = describeNameOwner(config, name);
    errorOut(`Name "${name}" is already in use as ${owner}.`);
    process.exit(1);
  }
}
