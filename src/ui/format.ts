import pc from "picocolors";

// Windows Terminal 对 Unicode 字符宽度渲染不一致，需要额外空格
const GAP = process.platform === "win32" ? "  " : " ";

export function success(msg: string): void {
  console.log(`${pc.green("✔")}${GAP}${msg}`);
}

export function error(msg: string): void {
  console.error(`${pc.red("✖")}${GAP}${msg}`);
}

export function info(msg: string): void {
  console.log(`${pc.cyan("ℹ")}${GAP}${msg}`);
}

export function warn(msg: string): void {
  console.log(`${pc.yellow("⚠")}${GAP}${msg}`);
}

export function dim(s: string): string {
  return pc.dim(s);
}

export function bold(s: string): string {
  return pc.bold(s);
}

export function green(s: string): string {
  return pc.green(s);
}

export function red(s: string): string {
  return pc.red(s);
}

export function yellow(s: string): string {
  return pc.yellow(s);
}

export function cyan(s: string): string {
  return pc.cyan(s);
}
