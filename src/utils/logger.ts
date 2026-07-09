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
  const now = new Date();
  // 使用本地时区格式化，替代 toISOString() 的 UTC 时间
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
  const line = `[${ts}] [${level}] ${msg}\n`;
  process.stderr.write(line);
}
