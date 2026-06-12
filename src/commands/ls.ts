// ============================================================================
// cctra ls：全局 alias / model 列表（3 段式纯文本，alias-rooted）
// ============================================================================
import { Command } from "commander";
import { withConfig } from "./shared";
import { dim, green, cyan, info } from "../ui/format";
import { padEndStr, printSection } from "../ui/table";

interface ModelRow {
  full: string;     // "source/modelId"
  source: string;   // 显示用：vendor / displayName / name
}

export function registerLs(program: Command): void {
  program
    .command("ls")
    .alias("list")
    .description("List all aliases and models")
    .action(() => {
      withConfig((config) => {
        // 1. 收集所有 alias 和 model
        const aliasEntries = Object.entries(config.aliases);
        const allModels: ModelRow[] = [];
        for (const [name, provider] of Object.entries(config.providers)) {
          for (const m of provider.models) {
            allModels.push({ full: `${name}/${m.id}`, source: provider.vendor ?? name });
          }
        }
        for (const [name, p] of Object.entries(config.plugins)) {
          if (!p.enabled) continue;
          for (const m of p.models) {
            allModels.push({ full: `${name}/${m.id}`, source: p.displayName ?? name });
          }
        }

        if (allModels.length === 0 && aliasEntries.length === 0) {
          info("Empty config. Run `cctra add` to add a provider.");
          return;
        }

        // 2. 分桶
        const bound = aliasEntries.filter(([, v]) => v !== "");
        const unbound = aliasEntries.filter(([, v]) => v === "").map(([n]) => n);

        const aliasedFullNames = new Set(bound.map(([, v]) => v));
        const otherModels = allModels.filter((m) => !aliasedFullNames.has(m.full));

        // 3. 排序
        // ALIASES 段按 (value, name) 让同 model 的 alias 物理聚集
        bound.sort(([na, va], [nb, vb]) => va.localeCompare(vb) || na.localeCompare(nb));
        unbound.sort((a, b) => a.localeCompare(b));
        otherModels.sort((a, b) => a.full.localeCompare(b.full));

        // 4. 列宽（基于纯文本，不含 ANSI）
        const aliasW = bound.length > 0
          ? Math.max(...bound.map(([n]) => n.length))
          : 0;
        const fullWInAliasSection = bound.length > 0
          ? Math.max(...bound.map(([, v]) => v.length))
          : 0;
        const fullWInOtherSection = otherModels.length > 0
          ? Math.max(...otherModels.map((m) => m.full.length))
          : 0;

        // 5. 渲染
        if (bound.length > 0) {
          const rows = bound.map(([name, value]) => {
            // 找 source 显示名
            const [srcName] = value.split("/", 1);
            const src = allModels.find((m) => m.full === value)?.source ?? srcName;
            return `${green(padEndStr(name, aliasW))}  ${dim(cyan("→"))} ${padEndStr(value, fullWInAliasSection)}  ${dim(`[${src}]`)}`;
          });
          printSection("ALIASES", rows);
        }

        if (unbound.length > 0) {
          if (bound.length > 0) console.log();
          printSection("UNBOUND", unbound.map((n) => dim(n)));
        }

        if (otherModels.length > 0) {
          if (bound.length > 0 || unbound.length > 0) console.log();
          const rows = otherModels.map((m) =>
            `${padEndStr(m.full, fullWInOtherSection)}  ${dim(`[${m.source}]`)}`,
          );
          printSection("OTHER MODELS", rows);
        }
      });
    });
}
