/** 简单 logger：只写 stderr（带时间戳和级别）。前景 serve 用，要持久日志自己 `2> serve.log`。 */
export const logger = {
  info(msg: string): void {
    log("INFO", msg);
  },
  warn(msg: string): void {
    log("WARN", msg);
  },
  error(msg: string): void {
    log("ERROR", msg);
  },
  debug(msg: string): void {
    if (process.env.CCTRA_DEBUG) log("DEBUG", msg);
  },
};

function log(level: string, msg: string): void {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  process.stderr.write(line);
}
