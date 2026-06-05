// ============================================================================
// cctra show <name>：显示订阅/插件详情
// ============================================================================
import { Command } from "commander";
import { withConfig } from "./shared";
import { maskToken } from "../ui/prompts";
import { bold, dim, info } from "../ui/format";
import { getSource } from "../core/source";

export function registerShow(program: Command): void {
  program
    .command("show <name>")
    .description("Show details of a subscription or plugin")
    .action((name: string) => {
      withConfig((config) => {
        const s = getSource(config, name);
        if (!s) {
          info(`Not found: "${name}"`);
          return;
        }

        console.log(bold(`${s.name}`) + `  ${dim(`(${s.kind})`)}`);
        if (s.kind === "subscription") {
          console.log(`  ${dim("endpoint:")}  ${s.endpoint}`);
          console.log(`  ${dim("token:")}     ${maskToken(s.token)}`);
          console.log(`  ${dim("format:")}    ${s.apiFormat}`);
        } else {
          console.log(`  ${dim("path:")}      ${s.path}`);
          console.log(`  ${dim("enabled:")}   ${s.enabled}`);
          console.log(`  ${dim("config:")}    ${JSON.stringify(s.config)}`);
        }
        console.log(`  ${dim("models:")}`);
        if (s.models.length === 0) {
          console.log(`    ${dim("(none)")}`);
        } else {
          for (const m of s.models) {
            const alias = m.alias ? ` ${dim(`(alias: ${m.alias})`)}` : "";
            console.log(`    - ${m.id}${alias}`);
          }
        }
      });
    });
}
