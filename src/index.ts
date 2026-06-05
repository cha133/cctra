// ============================================================================
// CLI 入口：commander 注册所有子命令
// ============================================================================
import { Command } from "commander";
import { registerAdd } from "./commands/add";
import { registerLs } from "./commands/ls";
import { registerShow } from "./commands/show";
import { registerRm } from "./commands/rm";
import { registerRename } from "./commands/rename";
import { registerModel } from "./commands/model";
import { registerPlugin } from "./commands/plugin";
import { registerTier } from "./commands/tier";
import { registerDaemon } from "./commands/daemon";
import { registerServe } from "./commands/serve";

const VERSION = "0.1.0";

const program = new Command();
program
  .name("cctra")
  .description("Local LLM subscription protocol converter + plugin host")
  .version(VERSION, "-v, --version");

registerAdd(program);
registerLs(program);
registerShow(program);
registerRm(program);
registerRename(program);
registerModel(program);
registerPlugin(program);
registerTier(program);
registerDaemon(program);
registerServe(program);

program.parse(process.argv);
