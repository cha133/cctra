// ============================================================================
// port-check 单元测试
// ----------------------------------------------------------------------------
// 覆盖：readPidFile 缺失/坏 JSON/pid=0/port 越界 → null；
// writePidFile+readPidFile 往返；clearPidFile 幂等；isPidAlive 真/假 PID。
//
// kill / probe / findListeningPid 不在单测范围（跨平台 spawn + 网络），
// 留给 §Verification 的 PowerShell 手测。
//
// 隔离：本测试不设 CCTRA_CONFIG，直接读写 ~/.local/state/cctra/serve.pid。
// beforeAll/afterAll 备份与还原真实 PID 文件，避免污染运行环境。
// bunfig.toml 的 preload 脚本设了 CCTRA_NO_MIGRATE=1，migration 不会跑。
// ============================================================================
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  existsSync,
  copyFileSync,
  unlinkSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearPidFile,
  isPidAlive,
  readPidFile,
  servePidFilePath,
  writePidFile,
} from "../src/utils/port-check";
import { xdgStateHome } from "../src/utils/xdg";

let originalPidFile: string | null = null;
const backupPath = join(tmpdir(), `cctra-pidfile-backup-${process.pid}.json`);

beforeAll(() => {
  // 真实环境可能有 ~/.local/state/cctra/serve.pid，先备份
  const live = servePidFilePath();
  if (live && existsSync(live)) {
    originalPidFile = live;
    copyFileSync(live, backupPath);
    unlinkSync(live);
  }
  // 跑测试时一定不设 CCTRA_CONFIG
  delete process.env.CCTRA_CONFIG;
  // 确保 ~/.local/state/cctra 存在（readPidFile 不创建，但测试要写坏文件进去）
  mkdirSync(join(xdgStateHome(), "cctra"), { recursive: true });
});

afterAll(() => {
  clearPidFile();
  if (originalPidFile && existsSync(backupPath)) {
    copyFileSync(backupPath, originalPidFile);
    unlinkSync(backupPath);
  }
});

describe("port-check", () => {
  test("readPidFile returns null when file is missing", () => {
    clearPidFile();
    expect(readPidFile()).toBeNull();
  });

  test("readPidFile returns null on empty file", () => {
    writeFileSync(servePidFilePath()!, "", "utf-8");
    expect(readPidFile()).toBeNull();
  });

  test("readPidFile returns null on malformed JSON", () => {
    writeFileSync(servePidFilePath()!, "not json at all {", "utf-8");
    expect(readPidFile()).toBeNull();
  });

  test("readPidFile returns null when pid is 0 or negative or non-integer", () => {
    const now = Date.now();
    writeFileSync(servePidFilePath()!, JSON.stringify({ pid: 0, port: 3133, startedAt: now }), "utf-8");
    expect(readPidFile()).toBeNull();
    writeFileSync(servePidFilePath()!, JSON.stringify({ pid: -1, port: 3133, startedAt: now }), "utf-8");
    expect(readPidFile()).toBeNull();
    writeFileSync(servePidFilePath()!, JSON.stringify({ pid: 1.5, port: 3133, startedAt: now }), "utf-8");
    expect(readPidFile()).toBeNull();
  });

  test("readPidFile returns null when port is out of range", () => {
    const now = Date.now();
    writeFileSync(servePidFilePath()!, JSON.stringify({ pid: 1234, port: 0, startedAt: now }), "utf-8");
    expect(readPidFile()).toBeNull();
    writeFileSync(servePidFilePath()!, JSON.stringify({ pid: 1234, port: 99999, startedAt: now }), "utf-8");
    expect(readPidFile()).toBeNull();
  });

  test("writePidFile + readPidFile round-trips", () => {
    writePidFile(3133);
    const info = readPidFile();
    expect(info).not.toBeNull();
    expect(info!.pid).toBe(process.pid);
    expect(info!.port).toBe(3133);
    expect(info!.startedAt).toBeGreaterThan(0);
    expect(info!.startedAt).toBeLessThanOrEqual(Date.now());
  });

  test("clearPidFile is idempotent and removes the file", () => {
    writePidFile(3133);
    expect(existsSync(servePidFilePath()!)).toBe(true);
    clearPidFile();
    expect(existsSync(servePidFilePath()!)).toBe(false);
    expect(() => clearPidFile()).not.toThrow();
  });

  test("isPidAlive returns true for the current process pid", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  test("isPidAlive returns false for 0 / negative / non-integer", () => {
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(1.5)).toBe(false);
  });

  test("isPidAlive returns false for a clearly-unused high pid", () => {
    // 2^31 = 2147483648，远超任何 OS 默认 pid_max
    expect(isPidAlive(2 ** 31)).toBe(false);
  });

  test("writePidFile uses atomic rename (no .tmp leftover)", () => {
    writePidFile(3133);
    expect(existsSync(servePidFilePath()! + ".tmp")).toBe(false);
  });
});
