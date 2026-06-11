// ============================================================================
// cctra ls：全局模型列表（alias → full name）
// ============================================================================
import { Command } from "commander";
import { withConfig } from "./shared";
import { dim, bold, green, info } from "../ui/format";

interface Row {
  alias: string;       // 空字符串表示无 alias
  full: string;        // "source/modelId"
  source: string;      // 显示用：vendor / displayName / name
}

export function registerLs(program: Command): void {
  program
    .command("ls")
    .alias("list")
    .description("List all models across sources (alias → full name)")
    .action(() => {
      withConfig((config) => {
        const rows: Row[] = [];

        for (const [name, provider] of Object.entries(config.providers)) {
          for (const m of provider.models) {
            rows.push({
              alias: m.alias ?? "",
              full: `${name}/${m.id}`,
              source: provider.vendor ?? name,
            });
          }
        }
        for (const [name, p] of Object.entries(config.plugins)) {
          if (!p.enabled) continue;
          for (const m of p.models) {
            rows.push({
              alias: m.alias ?? "",
              full: `${name}/${m.id}`,
              source: p.displayName ?? name,
            });
          }
        }

        if (rows.length === 0) {
          info("No models yet. Run `cctra add` to start.");
          return;
        }

        // 按 source → alias/id 排序
        rows.sort(
          (a, b) => a.source.localeCompare(b.source) || a.alias.localeCompare(b.alias) || a.full.localeCompare(b.full),
        );

        const aliasW = Math.max(5, ...rows.map((r) => Math.max(r.alias.length, 1)));
        const fullW = Math.max(9, ...rows.map((r) => r.full.length));
        const rule = dim("─".repeat(aliasW + fullW + 6));

        console.log(`${bold("ALIAS".padEnd(aliasW))}  ${bold("FULL NAME".padEnd(fullW))}  ${bold("SOURCE")}`);
        console.log(rule);
        for (const r of rows) {
          const a = r.alias
            ? green(r.alias.padEnd(aliasW))
            : dim("(none)").padEnd(aliasW);
          const f = r.full.padEnd(fullW);
          const s = dim(r.source);
          console.log(`${a}  ${f}  ${s}`);
        }
      });
    });
}
