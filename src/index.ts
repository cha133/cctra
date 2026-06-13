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
import { registerSwitch } from "./commands/switch";
import { registerPlugin } from "./commands/plugin";
import { registerRectify } from "./commands/rectify";
import { registerServe } from "./commands/serve";
import { registerTest } from "./commands/test";
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
registerSwitch(program);
registerPlugin(program);
registerRectify(program);
registerServe(program);
registerTest(program);

program.parse(process.argv);
