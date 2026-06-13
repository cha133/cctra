// ============================================================================
// cctra rectify <subcommand>：管理 vendor-quirk 整流规则
// ls / enable <rule> / disable <rule> / attach <provider> <rule> / detach <provider> <rule>
// ============================================================================
import { Command } from "commander";
import { withConfig } from "./shared";
import { BUILTIN_RULE_IDS, summarizeRectifyConfig } from "../convert/upstream/rectify";
import { success, error as errorOut, info, dim, green, red } from "../ui/format";

export function registerRectify(program: Command): void {
  const r = program
    .command("rectify")
    .description("Manage request-body rectifiers for vendor quirks (e.g. Kimi thinking.type)");

  r.command("ls")
    .description("List built-in rules + per-provider attachments")
    .action(() => ls());

  r.command("enable <rule>")
    .description("Globally enable a rule (still needs per-provider attach to take effect)")
    .action((id: string) => setGlobal(id, true));

  r.command("disable <rule>")
    .description("Globally disable a rule")
    .action((id: string) => setGlobal(id, false));

  r.command("attach <provider> <rule>")
    .description("Attach a rule to a provider (whitelist — only attached providers run rules)")
    .action((provider: string, rule: string) => attach(provider, rule));

  r.command("detach <provider> <rule>")
    .description("Remove a rule attachment from a provider")
    .action((provider: string, rule: string) => detach(provider, rule));
}

// ---------------------------------------------------------------------------

function ls(): void {
  withConfig((config) => {
    const { rules, attachments } = summarizeRectifyConfig(config);
    if (rules.length === 0) {
      info("No built-in rules registered.");
      return;
    }
    info("Built-in rules:");
    for (const r of rules) {
      const status = r.enabled ? green("✓ enabled") : red("✗ disabled");
      console.log(`  ${r.id}  ${status}`);
      console.log(`    ${dim(r.displayName)}`);
      console.log(`    ${dim(r.description)}`);
    }
    if (attachments.length === 0) {
      console.log("");
      info("No per-provider attachments. Use `cctra rectify attach <provider> <rule>` to enable.");
    } else {
      console.log("");
      info("Per-provider attachments:");
      for (const a of attachments) {
        const active = a.rules.filter((id) => {
          const enabled = config.rectify?.rules?.[id] === true;
          return enabled;
        });
        if (active.length === 0) {
          console.log(`  ${a.source}  ${dim(`(${a.rules.join(", ")} — all disabled globally)`)}`);
        } else {
          console.log(`  ${a.source}  ${dim("→")} ${active.join(", ")}`);
        }
      }
    }
  });
}

function setGlobal(ruleId: string, enabled: boolean): void {
  if (!BUILTIN_RULE_IDS.has(ruleId)) {
    errorOut(`Unknown rule "${ruleId}". Built-in rules: ${[...BUILTIN_RULE_IDS].join(", ")}`);
    process.exit(1);
  }
  withConfig((config) => {
    if (!config.rectify) config.rectify = { rules: {}, providers: {} };
    if (!config.rectify.rules) config.rectify.rules = {};
    config.rectify.rules[ruleId] = enabled;
  });
  success(`${enabled ? "Enabled" : "Disabled"} "${ruleId}" globally.`);
}

function attach(provider: string, ruleId: string): void {
  if (!BUILTIN_RULE_IDS.has(ruleId)) {
    errorOut(`Unknown rule "${ruleId}". Built-in rules: ${[...BUILTIN_RULE_IDS].join(", ")}`);
    process.exit(1);
  }
  withConfig((config) => {
    if (!config.rectify) config.rectify = { rules: {}, providers: {} };
    if (!config.rectify.providers) config.rectify.providers = {};
    if (config.plugins[provider]) {
      errorOut(`"${provider}" is a plugin. Plugins handle their own quirks via JS — cctra's rectify does not apply to plugin upstreams.`);
      process.exit(1);
    }
    if (!config.providers[provider]) {
      errorOut(`Provider "${provider}" not found. Add it first with \`cctra add\`.`);
      process.exit(1);
    }
    const list = config.rectify.providers[provider] ?? [];
    if (list.includes(ruleId)) {
      info(`"${ruleId}" is already attached to "${provider}". No change.`);
      return;
    }
    config.rectify.providers[provider] = [...list, ruleId];
  });
  success(`Attached "${ruleId}" to provider "${provider}".`);
}

function detach(provider: string, ruleId: string): void {
  withConfig((config) => {
    const list = config.rectify?.providers?.[provider] ?? [];
    if (!list.includes(ruleId)) {
      info(`"${ruleId}" is not attached to "${provider}". No change.`);
      return;
    }
    config.rectify!.providers![provider] = list.filter((r) => r !== ruleId);
    if (config.rectify!.providers![provider].length === 0) {
      delete config.rectify!.providers![provider];
    }
  });
  success(`Detached "${ruleId}" from provider "${provider}".`);
}