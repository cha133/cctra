// ============================================================================
// cctra ls：全局模型列表（alias → full name）
// ============================================================================
import { Command } from "commander";
import { withConfig } from "./shared";
import { Table } from "console-table-printer";
import { dim, green, info } from "../ui/format";

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

        const displayRows = rows.map((r) => ({
          alias: r.alias ? green(r.alias) : dim("(none)"),
          full: r.full,
          source: dim(r.source),
        }));

        new Table({
          columns: [
            { name: "alias",  title: "ALIAS",     alignment: "left" },
            { name: "full",   title: "FULL NAME", alignment: "left" },
            { name: "source", title: "SOURCE",    alignment: "left" },
          ],
          rows: displayRows,
        }).printTable();
      });
    });
}
