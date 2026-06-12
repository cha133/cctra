// ============================================================================
// cctra plugin <subcommand>：管理插件
// add / ls / show / enable / disable / rm
// ============================================================================
import { Command } from "commander";
import * as p from "@clack/prompts";
import { existsSync, statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { withConfig } from "./shared";
import { checkCancel } from "../ui/prompts";
import { success, error as errorOut, warn, info, dim } from "../ui/format";
import { addPlugin, updatePlugin, removePlugin } from "../core/config";
import { loadPlugin, clearPluginCache } from "../plugin/loader";
import { autoAliasValue } from "../core/alias";
import { isSourceName } from "../core/namespace";
import type { PluginConfig } from "../types";

export function registerPlugin(program: Command): void {
  const plugin = program.command("plugin").description("Manage local-path plugins");

  // cctra plugin add <name> <path>
  plugin
    .command("add <name> <path>")
    .description("Add a local-path plugin")
    .action(async (name: string, path: string) => {
      try {
        // 验证文件存在
        if (!existsSync(path)) {
          errorOut(`File not found: ${path}`);
          return;
        }

        // 计算 sha256
        const content = readFileSync(path);
        const sha256 = createHash("sha256").update(content).digest("hex");
        const sizeKB = (statSync(path).size / 1024).toFixed(1);

        // 警告 + 确认
        warn("Plugin is arbitrary JavaScript. Loading gives it full process permissions.");
        console.log(`  ${dim("Path:")}     ${path}`);
        console.log(`  ${dim("Size:")}     ${sizeKB} KB`);
        console.log(`  ${dim("SHA-256:")}  ${sha256}`);
        const ok = checkCancel(
          await p.confirm({ message: "Continue?", initialValue: false }),
        );
        if (!ok) return;

        // 配置（这里先用空对象，v1 不做交互式 schema 推断）
        const configRaw = checkCancel(
          await p.text({ message: "Plugin config (JSON, optional):", defaultValue: "{}", validate: (v) => {
            if (!v) return undefined;
            try { JSON.parse(v); return undefined; } catch { return "Invalid JSON"; }
          }}),
        );
        const config = JSON.parse(configRaw) as Record<string, unknown>;

        // 尝试 import 一下确认合法
        const tempPlugin: PluginConfig = {
          kind: "plugin",
          name,
          path,
          config,
          enabled: true,
          models: [],
        };
        const instance = await loadPlugin(tempPlugin, withConfig((c) => c));
        if (!instance) {
          errorOut(`Plugin failed to load. Check the file's syntax.`);
          return;
        }
        // 拉模型列表（plugin 可以通过 PluginModel.alias 声明短名）
        let pluginModels: { id: string; alias?: string }[] = [];
        if (instance.listModels) {
          try {
            const { makePluginContext } = await import("../plugin/host");
            const ctx = makePluginContext(name, config);
            pluginModels = (await instance.listModels(ctx)).map((m) => ({ id: m.id, alias: m.alias }));
          } catch (e) {
            warn(`listModels() failed: ${(e as Error).message}`);
          }
        }
        tempPlugin.models = pluginModels.map((m) => ({ id: m.id }));

        withConfig((c) => {
          if (c.plugins[name]) updatePlugin(c, tempPlugin);
          else addPlugin(c, tempPlugin);
          // 注册 plugin 自带的 alias + auto-alias（id 全局唯一时）
          for (const m of pluginModels) {
            const full = `${name}/${m.id}`;
            if (m.alias && c.aliases[m.alias] === undefined && !isSourceName(c, m.alias)) {
              c.aliases[m.alias] = full;
            }
            const auto = autoAliasValue(m.id, name, c);
            if (auto) c.aliases[m.id] = auto;
          }
        });
        success(`Added plugin "${name}" with ${pluginModels.length} model(s).`);
      } catch (e) {
        errorOut((e as Error).message);
        process.exit(1);
      }
    });

  // cctra plugin ls
  plugin
    .command("ls")
    .description("List installed plugins")
    .action(() => {
      withConfig((config) => {
        const plugins = Object.values(config.plugins);
        if (plugins.length === 0) {
          info("No plugins installed. Try `cctra plugin add <name> <path>`.");
          return;
        }
        for (const p of plugins) {
          const status = p.enabled ? "✓ enabled" : "✗ disabled";
          console.log(`- ${p.name}  ${dim(`(${p.models.length} model${p.models.length === 1 ? "" : "s"}, ${status})`)}`);
          console.log(`    ${dim("path:")} ${p.path}`);
        }
      });
    });

  // cctra plugin show <name>
  plugin
    .command("show <name>")
    .description("Show plugin details")
    .action((name: string) => {
      withConfig((config) => {
        const p = config.plugins[name];
        if (!p) { errorOut(`Plugin "${name}" not found.`); return; }
        console.log(`${p.name}  ${dim(`(${p.enabled ? "enabled" : "disabled"})`)}`);
        console.log(`  ${dim("path:")}    ${p.path}`);
        console.log(`  ${dim("config:")}  ${JSON.stringify(p.config)}`);
        console.log(`  ${dim("models:")}`);
        for (const m of p.models) {
          const full = `${name}/${m.id}`;
          const aliases = Object.entries(config.aliases)
            .filter(([, v]) => v === full)
            .map(([n]) => n);
          const aliasHint = aliases.length > 0 ? ` ${dim(`(aliases: ${aliases.join(", ")})`)}` : "";
          console.log(`    - ${m.id}${aliasHint}`);
        }
      });
    });

  // cctra plugin enable / disable <name>
  plugin
    .command("enable <name>")
    .description("Enable a plugin")
    .action((name: string) => {
      withConfig((config) => {
        if (!config.plugins[name]) throw new Error(`Plugin "${name}" not found.`);
        config.plugins[name]!.enabled = true;
      });
      clearPluginCache();
      success(`Enabled "${name}".`);
    });

  plugin
    .command("disable <name>")
    .description("Disable a plugin")
    .action((name: string) => {
      withConfig((config) => {
        if (!config.plugins[name]) throw new Error(`Plugin "${name}" not found.`);
        config.plugins[name]!.enabled = false;
      });
      clearPluginCache();
      success(`Disabled "${name}".`);
    });

  // cctra plugin rm <name>
  plugin
    .command("rm <name>")
    .description("Remove a plugin (does not delete the .js file)")
    .action((name: string) => {
      withConfig((config) => {
        if (!config.plugins[name]) throw new Error(`Plugin "${name}" not found.`);
        removePlugin(config, name);
      });
      success(`Removed plugin "${name}".`);
    });
}
