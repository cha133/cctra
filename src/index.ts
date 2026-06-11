// ============================================================================
// CLI 入口：commander 注册所有子命令
// ============================================================================
import { Command } from "commander";
import { registerAdd } from "./commands/add";
import { registerLs } from "./commands/ls";
import { registerShow } from "./commands/show";
import { registerRm } from "./commands/rm";
import { registerRename } from "./commands/rename";
import { registerEdit } from "./commands/edit";
import { registerAlias } from "./commands/alias";
import { registerPlugin } from "./commands/plugin";
import { registerServe } from "./commands/serve";
import pkg from "../package.json";

const program = new Command();
program
  .name("cctra")
  .description("Local LLM provider protocol converter + plugin host")
  .version(pkg.version, "-v, --version");

registerAdd(program);
registerLs(program);
registerShow(program);
registerRm(program);
registerRename(program);
registerEdit(program);
registerAlias(program);
registerPlugin(program);
registerServe(program);

program.parse(process.argv);
