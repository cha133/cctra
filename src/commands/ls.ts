// ============================================================================
// cctra ls：列出所有 source
// ============================================================================
import { Command } from "commander";
import { withConfig } from "./shared";
import { green, dim, bold } from "../ui/format";
import { info } from "../ui/format";

export function registerLs(program: Command): void {
  program
    .command("ls")
    .alias("list")
    .description("List all subscriptions and plugins")
    .action(() => {
      withConfig((config) => {
        const subs = Object.values(config.subscriptions);
        const plugins = Object.values(config.plugins);

        if (subs.length === 0 && plugins.length === 0) {
          info("No subscriptions or plugins yet. Run `cctra add` to start.");
          return;
        }

        if (subs.length > 0) {
          console.log(bold("Subscriptions:"));
          for (const [i, sub] of subs.entries()) {
            const marker = green("*");
            const index = dim(`${i + 1}.`);
            const name = green(sub.name);
            const vendorPart = sub.vendor ? ` ${dim(`[${sub.vendor}]`)}` : "";
            const meta = ` ${dim(`(${sub.apiFormat}, ${sub.models.length} model${sub.models.length === 1 ? "" : "s"})`)}`;
            console.log(`${marker} ${index} ${name}${vendorPart}${meta}`);
          }
        }

        if (plugins.length > 0) {
          if (subs.length > 0) console.log("");
          console.log(bold("Plugins:"));
          for (const [i, p] of plugins.entries()) {
            const marker = p.enabled ? green("*") : " ";
            const index = dim(`${i + 1}.`);
            const name = p.enabled ? p.name : dim(p.name);
            const meta = ` ${dim(`(${p.enabled ? "enabled" : "disabled"}, ${p.models.length} model${p.models.length === 1 ? "" : "s"})`)}`;
            console.log(`${marker} ${index} ${name}${meta}`);
          }
        }
      });
    });
}
