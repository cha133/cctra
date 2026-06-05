// cctra-launcher: Windows 启动器
// 职责：
//   1. 找到自己的可执行文件位置
//   2. 解析同目录的 cctra-daemon.js（实际是 bin/cctra.js）路径
//   3. 用 CREATE_NO_WINDOW + detached 标志启动 bun
//   4. 立即退出（detach）
//
// 编译时 windows_subsystem = "windows" 避免弹出黑框

#![windows_subsystem = "windows"]

use std::env;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;

fn main() {
    // 1. 找到自己的位置
    let exe_path = match env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[cctra-launcher] failed to get current exe: {}", e);
            std::process::exit(1);
        }
    };
    let _exe_dir = exe_path.parent().unwrap_or_else(|| std::path::Path::new("."));

    // 2. 找 bun + cctra 入口
    let cctra_entry = locate_cctra_entry();
    let bun_path = which_bun().unwrap_or_else(|| "bun.exe".to_string());

    // 3. 启动 bun 跑 serve
    let mut cmd = Command::new(&bun_path);
    cmd.arg("run")
        .arg(&cctra_entry)
        .arg("serve")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);

    match cmd.spawn() {
        Ok(child) => {
            // 立即退出（detached child 会继续跑）
            drop(child);
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("[cctra-launcher] failed to start bun: {}", e);
            eprintln!("  bun path: {}", bun_path);
            eprintln!("  cctra entry: {}", cctra_entry);
            std::process::exit(1);
        }
    }
}

fn which_bun() -> Option<String> {
    // 尝试常见位置
    let candidates = [
        "C:\\Scoop\\shims\\bun.exe",
        "C:\\Program Files\\nodejs\\bun.exe",
        "C:\\Users\\%USERNAME%\\.bun\\bin\\bun.exe",
    ];
    for c in &candidates {
        let expanded = c.replace("%USERNAME%", &env::var("USERNAME").unwrap_or_default());
        if std::path::Path::new(&expanded).exists() {
            return Some(expanded.to_string());
        }
    }
    // 走 PATH
    if let Ok(out) = Command::new("where").arg("bun.exe").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).lines().next().unwrap_or("").trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    None
}

fn locate_cctra_entry() -> String {
    // 1. 优先从环境变量 CCTRA_BIN 读
    if let Ok(p) = env::var("CCTRA_BIN") {
        if std::path::Path::new(&p).exists() {
            return p;
        }
    }

    // 2. 常见 npm 全局位置
    let candidates = [
        "C:\\Program Files\\nodejs\\node_modules\\cctra\\bin\\cctra.js",
        "C:\\Users\\%USERNAME%\\AppData\\Roaming\\npm\\node_modules\\cctra\\bin\\cctra.js",
    ];
    for c in &candidates {
        let expanded = c.replace("%USERNAME%", &env::var("USERNAME").unwrap_or_default());
        if std::path::Path::new(&expanded).exists() {
            return expanded.to_string();
        }
    }

    // 3. 兜底：同目录的 cctra.js
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            let p: PathBuf = parent.join("cctra.js");
            if p.exists() {
                return p.to_string_lossy().to_string();
            }
        }
    }

    // 4. 最后兜底
    "cctra".to_string()
}
