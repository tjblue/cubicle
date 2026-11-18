#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod browser;
mod extensions;
mod terminal_shell;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{collections::HashMap, io::{Read, Write}, sync::{Arc, Mutex}, thread};
use tauri::{ipc::Channel, Emitter, Manager, State};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: TerminalWriter,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct Terminals(Mutex<HashMap<String, Session>>);

type TerminalWriter = Arc<Mutex<Box<dyn Write + Send>>>;

async fn write_terminal_input(writer: TerminalWriter, data: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut writer = writer.lock().map_err(|e| e.to_string())?;
        writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
enum TerminalEvent {
    Output(Vec<u8>),
    Exit,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { cols: cols.max(1), rows: rows.max(1), pixel_width: 0, pixel_height: 0 }
}

#[tauri::command]
fn terminal_start(app: tauri::AppHandle, terminals: State<'_, Terminals>, id: String, cols: u16, rows: u16, cwd: Option<String>, shell: Option<String>, env: Option<HashMap<String, String>>, output: Channel<TerminalEvent>) -> Result<(), String> {
    let mut sessions = terminals.0.lock().map_err(|e| e.to_string())?;
    if sessions.contains_key(&id) { return Err("Terminal already exists".into()); }
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let default_shell = String::from("powershell.exe");
    #[cfg(not(windows))]
    let default_shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let selected_shell = shell.as_deref().filter(|s| !s.trim().is_empty()).unwrap_or(&default_shell);
    let mut command = CommandBuilder::new(selected_shell);
    command.env("TERM", "xterm-256color");
    if let Some(env) = env { for (key, value) in env { command.env(key, value); } }
    terminal_shell::configure(&mut command, selected_shell);
    if let Some(path) = cwd {
        let validated = validate_directory(path)?;
        command.cwd(display_windows_path(&validated));
    } else if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) { command.cwd(home); }
    let mut child = pair.slave.spawn_command(command).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| { let _ = child.kill(); e.to_string() })?;
    let writer = pair.master.take_writer().map_err(|e| { let _ = child.kill(); e.to_string() })?;
    sessions.insert(id.clone(), Session { master: pair.master, writer: Arc::new(Mutex::new(writer)), child });
    drop(sessions);
    thread::spawn(move || {
        let mut buffer = [0; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => { if output.send(TerminalEvent::Output(buffer[..n].to_vec())).is_err() { break; } }
            }
        }
        if let Some(manager) = app.try_state::<Terminals>() {
            if let Ok(mut sessions) = manager.0.lock() { sessions.remove(&id); }
        }
        let _ = output.send(TerminalEvent::Exit);
    });
    Ok(())
}

#[tauri::command]
async fn terminal_write(terminals: State<'_, Terminals>, id: String, data: String) -> Result<(), String> {
    let writer = {
        let sessions = terminals.0.lock().map_err(|e| e.to_string())?;
        Arc::clone(&sessions.get(&id).ok_or("Terminal is not running")?.writer)
    };
    // A full PTY input buffer must not block the UI or hold the registry lock
    // needed to resize, close, or write to another terminal.
    write_terminal_input(writer, data).await
}

#[tauri::command]
fn terminal_default_cwd() -> Option<String> {
    std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok()
}

#[tauri::command]
fn terminal_working_directory(terminals: State<'_, Terminals>, id: String) -> Result<Option<String>, String> {
    #[cfg(target_os = "linux")]
    {
        let sessions = terminals.0.lock().map_err(|e| e.to_string())?;
        let pid = sessions.get(&id).ok_or("Terminal is not running")?.child.process_id().ok_or("Terminal process is unavailable")?;
        Ok(linux_process_directory(pid))
    }
    #[cfg(not(target_os = "linux"))]
    { let _ = (terminals, id); Ok(None) }
}

#[cfg(target_os = "linux")]
fn linux_process_directory(pid: u32) -> Option<String> {
    let path = std::fs::read_link(format!("/proc/{pid}/cwd")).ok()?;
    if !path.is_dir() { return None; }
    path.to_str().map(str::to_owned)
}

#[tauri::command]
fn terminal_log_enter(pane_id: String, terminal_id: String, timestamp: String, cwd: Option<String>) -> Result<(), String> {
    if pane_id.len() > 128 || terminal_id.len() > 128 || timestamp.len() > 40 || cwd.as_ref().is_some_and(|v| v.len() > 32768) {
        return Err("Invalid diagnostic event".into());
    }
    let cwd = cwd.or_else(|| std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok());
    let path = hook_script_path()?.with_file_name("terminal-enter-events.jsonl");
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    let mut line = serde_json::to_vec(&serde_json::json!({"timestamp": timestamp, "paneId": pane_id, "terminalId": terminal_id, "cwd": cwd})).map_err(|e| e.to_string())?;
    line.push(b'\n');
    file.write_all(&line).map_err(|e| e.to_string())
}

#[tauri::command]
fn terminal_resize(terminals: State<'_, Terminals>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = terminals.0.lock().map_err(|e| e.to_string())?;
    sessions.get(&id).ok_or("Terminal is not running")?.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

#[tauri::command]
fn terminal_close(terminals: State<'_, Terminals>, id: String) -> Result<(), String> {
    if let Some(mut session) = terminals.0.lock().map_err(|e| e.to_string())?.remove(&id) { let _ = session.child.kill(); }
    Ok(())
}

#[tauri::command]
fn terminal_close_all(terminals: State<'_, Terminals>) -> Result<(), String> {
    let pending = {
        let mut sessions = terminals.0.lock().map_err(|e| e.to_string())?;
        std::mem::take(&mut *sessions)
    };
    let mut errors = Vec::new();
    for (id, mut session) in pending {
        if let Err(error) = session.child.kill() {
            // An already exited shell is harmless. Keep a still-running session
            // registered so a failed cleanup can be retried.
            if !matches!(session.child.try_wait(), Ok(Some(_))) {
                errors.push(format!("{id}: {error}"));
                terminals.0.lock().map_err(|e| e.to_string())?.insert(id, session);
            }
        }
    }
    if errors.is_empty() { Ok(()) } else { Err(format!("Could not close terminal sessions: {}", errors.join("; "))) }
}

// PowerShell displays verbatim Windows paths as provider-qualified paths.
fn display_windows_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") { format!(r"\\{}", rest) }
    else if let Some(rest) = path.strip_prefix(r"\\?\") {
        if rest.as_bytes().get(1) == Some(&b':') { rest.to_string() } else { path.to_string() }
    } else { path.to_string() }
}

#[tauri::command]
fn terminal_clipboard_read() -> Result<String, String> {
    arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.get_text())
        .map_err(|e| format!("Could not read clipboard: {e}"))
}

#[tauri::command]
fn terminal_clipboard_write(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut clipboard| clipboard.set_text(text))
        .map_err(|e| format!("Could not write clipboard: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HookConfigStatus { provider: String, path: String, state: String, detail: String }

#[cfg(windows)]
const HOOK_SCRIPT: &str = r#"param([Parameter(Mandatory=$true)][string]$Provider)
try {
  $raw = [Console]::In.ReadToEnd()
  $chain = @()
  $nextId = $PID
  try {
    for ($i = 0; $i -lt 16 -and $nextId -gt 0; $i++) {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId=$nextId" -ErrorAction Stop
      if (-not $process) { break }
      $chain += @{ pid = [int]$process.ProcessId; parentPid = [int]$process.ParentProcessId; name = $process.Name }
      if ($process.ParentProcessId -eq $nextId) { break }
      $nextId = [int]$process.ParentProcessId
    }
  } catch { }
  $record = @{ provider = $Provider; receivedAt = [DateTime]::UtcNow.ToString('o'); hookPid = $PID; processChain = @($chain); event = ($raw | ConvertFrom-Json) } | ConvertTo-Json -Depth 100 -Compress
  [IO.File]::AppendAllText((Join-Path $PSScriptRoot 'session-start-hooks.jsonl'), $record + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
"#;

#[cfg(not(windows))]
const UNIX_HOOK_SCRIPT: &str = r#"#!/bin/sh
set -eu
case "${1-}" in codex|claude|gemini) provider=$1 ;; *) exit 1 ;; esac
case "${CUBICLE_TERMINAL_ID-}" in
  ''|*[!a-zA-Z0-9_-]*) terminal=null ;;
  *) terminal="\"$CUBICLE_TERMINAL_ID\"" ;;
esac
event=$(tr -d '\r\n')
[ -n "$event" ] || exit 1
timestamp=$(date -u '+%Y-%m-%dT%H:%M:%S.%NZ')
directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
printf '{"provider":"%s","receivedAt":"%s","terminalId":%s,"event":%s}\n' "$provider" "$timestamp" "$terminal" "$event" >> "$directory/session-start-hooks.jsonl"
"#;

fn hook_script() -> &'static str {
    #[cfg(windows)] { HOOK_SCRIPT }
    #[cfg(not(windows))] { UNIX_HOOK_SCRIPT }
}

fn hook_paths() -> Result<Vec<(&'static str, std::path::PathBuf)>, String> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok_or("Home directory is unavailable")?;
    let home = std::path::PathBuf::from(home);
    let codex = std::env::var_os("CODEX_HOME").map(std::path::PathBuf::from).unwrap_or_else(|| home.join(".codex"));
    let claude = std::env::var_os("CLAUDE_CONFIG_DIR").map(std::path::PathBuf::from).unwrap_or_else(|| home.join(".claude"));
    Ok(vec![("Codex", codex.join("hooks.json")), ("Claude", claude.join("settings.json")), ("Gemini", home.join(".gemini").join("settings.json"))])
}
fn hook_script_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe.parent().ok_or("App directory is unavailable")?.join(if cfg!(windows) { "cubicle-session-start-hook.ps1" } else { "cubicle-session-start-hook.sh" }))
}
fn hook_command(provider: &str, script: &std::path::Path) -> String {
    if cfg!(windows) { format!("powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"{}\" -Provider {}", script.display(), provider.to_lowercase()) }
    else { format!("sh '{}' {}", script.to_string_lossy().replace('\'', "'\\''"), provider.to_lowercase()) }
}
fn read_hook_config(path: &std::path::Path) -> Result<serde_json::Value, String> {
    match std::fs::read(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(format!("Cannot read configuration: {e}")),
        Ok(bytes) => serde_json::from_slice(bytes.strip_prefix(&[0xef,0xbb,0xbf]).unwrap_or(&bytes)).map_err(|e| format!("Invalid JSON: {e}")),
    }
}
fn hook_present(config: &serde_json::Value, command: &str) -> bool {
    config.get("hooks").and_then(|v| v.get("SessionStart")).and_then(|v| v.as_array()).is_some_and(|groups| groups.iter().any(|group| {
        let unrestricted = group.get("matcher").is_none_or(|v| v.as_str().is_some_and(|s| s.is_empty() || s == "*"));
        unrestricted && group.get("hooks").and_then(|v| v.as_array()).is_some_and(|hooks| hooks.iter().any(|hook| hook.get("type").and_then(|v| v.as_str()) == Some("command") && hook.get("command").and_then(|v| v.as_str()) == Some(command)))
    }))
}
fn add_session_hook(config: &mut serde_json::Value, command: &str) -> Result<bool, String> {
    if hook_present(config, command) { return Ok(false); }
    let root = config.as_object_mut().ok_or("Configuration must be a JSON object")?;
    let hooks = root.entry("hooks").or_insert_with(|| serde_json::json!({})).as_object_mut().ok_or("hooks must be a JSON object")?;
    let starts = hooks.entry("SessionStart").or_insert_with(|| serde_json::json!([])).as_array_mut().ok_or("SessionStart must be an array")?;
    let mut handler = serde_json::json!({"type": "command", "command": command});
    if command.ends_with(" -Provider codex") || command.ends_with(" codex") { handler["async"] = serde_json::Value::Bool(true); }
    starts.push(serde_json::json!({"hooks": [handler]}));
    Ok(true)
}
#[tauri::command]
fn chat_resume_hook_status() -> Result<Vec<HookConfigStatus>, String> {
    let script = hook_script_path()?;
    let script_ok = std::fs::read_to_string(&script).is_ok_and(|s| s == hook_script());
    Ok(hook_paths()?.into_iter().map(|(provider, path)| {
        let command = hook_command(provider, &script);
        let (state, detail) = match read_hook_config(&path) {
            Err(e) => ("error", e),
            Ok(mut config) => match add_session_hook(&mut config, &command) {
                Err(e) => ("error", e),
                Ok(false) if provider == "Gemini" && (config.pointer("/hooksConfig/enabled").and_then(|v| v.as_bool()) == Some(false) || config.pointer("/hooksConfig/disabled").and_then(|v| v.as_array()).is_some_and(|items| items.iter().any(|v| v.as_str() == Some(&command)))) => ("error", "Gemini hooks are disabled in settings.".into()),
                Ok(false) if provider == "Claude" && config.get("disableAllHooks").and_then(|v| v.as_bool()) == Some(true) => ("error", "Claude hooks are disabled in settings.".into()),
                Ok(false) if script_ok => ("installed", "Hook entry and script found; CLI hook settings and trust can affect whether it runs.".into()),
                Ok(false) if script.exists() => ("error", "The hook script has changed or cannot be read; it will not be overwritten.".into()),
                Ok(false) => ("missing", "Hook script is missing; add the hook to restore it.".into()),
                Ok(true) => ("missing", "Cubicle hook not configured.".into()),
            },
        };
        HookConfigStatus { provider: provider.into(), path: path.to_string_lossy().into_owned(), state: state.into(), detail }
    }).collect())
}
// Read only events written by configured Cubicle hooks. The bounded tail avoids loading chat history.
#[tauri::command]
fn chat_resume_recent_hooks() -> Result<Vec<serde_json::Value>, String> {
    use std::io::{Seek, SeekFrom};
    let mut logs = std::collections::HashSet::new();
    if hook_paths()?.iter().any(|(provider, path)| read_hook_config(path).is_ok_and(|config| hook_script_path().is_ok_and(|script| hook_present(&config, &hook_command(provider, &script))))) {
        logs.insert(hook_script_path()?.with_file_name("session-start-hooks.jsonl"));
    }
    for (_, path) in hook_paths()? {
        let config = match read_hook_config(&path) { Ok(v) => v, Err(_) => continue };
        if let Some(groups) = config.pointer("/hooks/SessionStart").and_then(|v| v.as_array()) {
            for group in groups { if let Some(items) = group.get("hooks").and_then(|v| v.as_array()) { for item in items {
                if let Some(cmd) = item.get("command").and_then(|v| v.as_str()) {
                    if let Some(script) = cmd.split('"').nth(1) {
                        let script = std::path::Path::new(script);
                        if script.file_name().is_some_and(|v| v == "cubicle-session-start-hook.ps1") {
                            if let Some(parent) = script.parent() { logs.insert(parent.join("session-start-hooks.jsonl")); }
                        }
                    }
                }
            } } }
        }
    }
    let mut events = Vec::new();
    for path in logs {
        if let Ok(mut file) = std::fs::File::open(path) {
            if let Ok(len) = file.metadata().map(|m| m.len()) {
                let start = len.saturating_sub(1024 * 1024);
                if file.seek(SeekFrom::Start(start)).is_err() { continue; }
                let mut text = String::new(); if file.read_to_string(&mut text).is_err() { continue; }
                for (index, line) in text.lines().enumerate() {
                    if start > 0 && index == 0 { continue; }
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) { events.push(value); }
                }
            }
        }
    }
    Ok(events)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct ProcessInfo { process_id: u32, parent_process_id: u32, name: String, command_line: Option<String> }

#[tauri::command]
async fn terminal_agent_kinds(terminals: State<'_, Terminals>, id: String) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let root = terminals.0.lock().map_err(|e| e.to_string())?.get(&id).and_then(|s| s.child.process_id()).ok_or("Terminal is not running")?;
        tauri::async_runtime::spawn_blocking(move || {
        let output = std::process::Command::new("powershell.exe").creation_flags(0x08000000).args(["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress"]).output().map_err(|e| e.to_string())?;
        if !output.status.success() { return Err("Cannot inspect terminal processes".into()); }
        let processes: Vec<ProcessInfo> = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
        let mut descendants = std::collections::HashSet::from([root]);
        for _ in 0..32 { let before = descendants.len(); for p in &processes { if descendants.contains(&p.parent_process_id) { descendants.insert(p.process_id); } } if descendants.len() == before { break; } }
        let mut found = std::collections::BTreeSet::new();
        for p in processes.iter().filter(|p| p.process_id != root && descendants.contains(&p.process_id)) {
            let name = p.name.to_ascii_lowercase(); let cmd = p.command_line.as_deref().unwrap_or("").to_ascii_lowercase();
            if name == "codex.exe" { found.insert("codex".to_string()); }
            if name == "claude.exe" || (name == "node.exe" && cmd.contains("claude-code")) { found.insert("claude".to_string()); }
            if name == "gemini.exe" || (name == "node.exe" && (cmd.contains("gemini-cli") || cmd.contains("gemini.js"))) { found.insert("gemini".to_string()); }
        }
        Ok(found.into_iter().collect())
        }).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    { let _ = (terminals, id); Err("Automatic CLI detection is only supported on Windows".into()) }
}

#[tauri::command]
fn chat_resume_install_hook(provider: String) -> Result<(), String> {
    let path = hook_paths()?.into_iter().find(|(name, _)| *name == provider).ok_or("Unknown CLI")?.1;
    let script = hook_script_path()?;
    install_session_hook(&path, &script, &provider)
}

fn install_session_hook(path: &std::path::Path, script: &std::path::Path, provider: &str) -> Result<(), String> {
    let original = match std::fs::read(path) {
        Ok(bytes) => Some(bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Cannot read configuration: {e}")),
    };
    let mut config = read_hook_config(&path)?;
    let changed = add_session_hook(&mut config, &hook_command(provider, script))?;
    if let Ok(existing) = std::fs::read_to_string(&script) { if existing != hook_script() { return Err("The Cubicle hook script has been modified; it was not overwritten.".into()); } }
    else if script.exists() { return Err("Cannot read the existing Cubicle hook script".into()); }
    else { std::fs::write(&script, hook_script()).map_err(|e| format!("Cannot write hook script: {e}"))?; }
    if changed {
        let parent = path.parent().ok_or("Invalid configuration path")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let json = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("Cannot prepare configuration update: {e}"))?;
        if let Ok(metadata) = std::fs::metadata(path) { temp.as_file().set_permissions(metadata.permissions()).map_err(|e| format!("Cannot preserve configuration permissions: {e}"))?; }
        temp.write_all(&json).and_then(|_| temp.as_file().sync_all()).map_err(|e| format!("Cannot write configuration: {e}"))?;
        let current = match std::fs::read(path) { Ok(bytes) => Some(bytes), Err(e) if e.kind() == std::io::ErrorKind::NotFound => None, Err(e) => return Err(format!("Cannot recheck configuration: {e}")) };
        if current != original { return Err("Configuration changed while adding the hook; try again.".into()); }
        temp.persist(&path).map_err(|e| format!("Cannot update {}: {}", path.display(), e.error))?;
    }
    Ok(())
}

#[tauri::command]
fn close_to_tray_enabled() -> bool { cfg!(windows) }

fn main() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            #[cfg(windows)]
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            #[cfg(windows)]
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

                let show = MenuItem::with_id(app, "show", "Show Cubicle", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
                let reload = MenuItem::with_id(app, "reload", "Reload interface", true, None::<&str>)?;
                let restart = MenuItem::with_id(app, "restart", "Restart Cubicle", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &reload, &restart, &quit])?;
                let icon = app.default_window_icon().cloned().expect("default app icon is configured");

                TrayIconBuilder::new()
                    .icon(icon)
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "show" => show_main_window(app),
                        "reload" | "restart" => {
                            show_main_window(app);
                            let _ = app.emit(if event.id().as_ref() == "reload" { "tray-reload-requested" } else { "tray-restart-requested" }, ());
                        }
                        "quit" => {
                            show_main_window(app);
                            let _ = app.emit("tray-quit-requested", ());
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            show_main_window(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .register_uri_scheme_protocol("browsermeta", |ctx, request| {
            if request.method() == tauri::http::Method::POST && request.body().len() < 8192 {
                if let Some(id) = ctx.webview_label().strip_prefix("browser-") {
                    if let Ok(value) = String::from_utf8(request.body().to_vec()) {
                        let _ = ctx.app_handle().emit("browser-event", browser::BrowserEvent { id: id.to_string(), kind: "favicon", value });
                    }
                }
            }
            tauri::http::Response::builder().status(204).header("Access-Control-Allow-Origin", "*").body(Vec::new()).unwrap()
        })
        .manage(Terminals::default())
        .invoke_handler(tauri::generate_handler![restart_app, extensions::extensions_list, extensions::extensions_inspect, extensions::extensions_choose_folder, extensions::extensions_discover_edge, extensions::extensions_import, extensions::extensions_set_enabled, extensions::extensions_remove, close_to_tray_enabled, terminal_start, terminal_write, terminal_default_cwd, terminal_working_directory, terminal_log_enter, terminal_resize, terminal_close, terminal_close_all, terminal_clipboard_read, terminal_clipboard_write, chat_resume_hook_status, chat_resume_recent_hooks, terminal_agent_kinds, chat_resume_install_hook, validate_directory, choose_space_folder, choose_file_folder, list_files, preview_file, preview_image, save_markdown, resolve_file_link, browser::browser_file_url, browser::browser_create, browser::browser_position, browser::browser_navigate, browser::browser_action, browser::browser_close, browser::browser_close_all])
        .build(tauri::generate_context!())
        .expect("failed to build Cubicle")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(terminals) = app.try_state::<Terminals>() {
                    if let Ok(mut sessions) = terminals.0.lock() {
                        for (_, mut session) in sessions.drain() { let _ = session.child.kill(); }
                    }
                }
            }
        });
}

#[cfg(windows)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn session_hook_merge_preserves_existing_config_and_is_idempotent() {
        let mut config = serde_json::json!({"theme":"dark", "hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"existing"}]}], "Stop":[{"other":true}]}});
        assert_eq!(add_session_hook(&mut config, "cubicle test").unwrap(), true);
        assert!(hook_present(&config, "cubicle test"));
        assert_eq!(add_session_hook(&mut config, "cubicle test").unwrap(), false);
        assert_eq!(config["hooks"]["SessionStart"].as_array().unwrap().len(), 2);
        assert_eq!(config["theme"], "dark");
        assert_eq!(config["hooks"]["Stop"][0]["other"], true);
        assert!(add_session_hook(&mut serde_json::json!({"hooks":"bad"}), "x").is_err());
    }

    #[test]
    fn normalizes_windows_terminal_paths() {
        assert_eq!(display_windows_path(r"\\?\C:\work"), r"C:\work");
        assert_eq!(display_windows_path(r"\\?\UNC\server\share"), r"\\server\share");
        assert_eq!(display_windows_path(r"C:\work"), r"C:\work");
    }

    #[test]
    fn windows_pty_accepts_input_and_can_be_resized() {
        let pair = native_pty_system().openpty(size(80, 24)).unwrap();
        let mut child = pair.slave.spawn_command(CommandBuilder::new("cmd.exe")).unwrap();
        drop(pair.slave);
        pair.master.resize(size(100, 30)).unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        thread::spawn(move || {
            let mut all = Vec::new();
            let mut buf = [0; 1024];
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 { break; }
                all.extend_from_slice(&buf[..n]);
                let _ = tx.send(String::from_utf8_lossy(&all).to_string());
                if String::from_utf8_lossy(&all).contains("CUBICLE_PTY_TEST") { break; }
            }
        });
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let mut received = String::new();
        let mut sent_command = false;
        while let Ok(text) = rx.recv_timeout(deadline.saturating_duration_since(std::time::Instant::now())) {
            received = text;
            if !sent_command && received.contains("\x1b[6n") {
                // ConPTY asks the terminal emulator for the cursor position at startup.
                writer.write_all(b"\x1b[1;1R").unwrap();
                writer.write_all(b"echo CUBICLE_PTY_TEST\r\nexit\r\n").unwrap();
                writer.flush().unwrap();
                sent_command = true;
            }
            if received.contains("CUBICLE_PTY_TEST") { break; }
        }
        let _ = child.kill();
        assert!(received.contains("CUBICLE_PTY_TEST"), "command output did not arrive through the PTY: {received:?}");
    }
}

use std::path::PathBuf;

#[derive(Serialize)]
struct FileEntry { name: String, path: String, directory: bool }
#[derive(Serialize)]
struct DirectoryListing { path: String, parent: Option<String>, entries: Vec<FileEntry> }

#[tauri::command]
fn validate_directory(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !path.is_absolute() { return Err("Enter an absolute folder path".into()); }
    let path = path.canonicalize().map_err(|e| format!("Cannot open folder: {e}"))?;
    if !path.is_dir() { return Err("The location is not a folder".into()); }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn choose_space_folder(initial_path: Option<String>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
            let mut picker = rfd::FileDialog::new().set_title("Choose a project folder");
            if let Some(path) = initial_path.filter(|path| std::path::Path::new(path).is_dir()) {
                picker = picker.set_directory(path);
            }
            Ok(picker.pick_folder().map(|path| path.to_string_lossy().into_owned()))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn choose_file_folder(initial_path: Option<String>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut picker = rfd::FileDialog::new().set_title("Choose a folder");
        if let Some(path) = initial_path.filter(|path| std::path::Path::new(path).is_dir()) {
            picker = picker.set_directory(path);
        }
        Ok(picker.pick_folder().map(|path| path.to_string_lossy().into_owned()))
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn list_files(path: Option<String>) -> Result<DirectoryListing, String> {
    let path = match path {
        Some(path) => PathBuf::from(path),
        None => PathBuf::from(std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok_or("Home directory is unavailable")?),
    };
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let directory = entry.path().is_dir();
        entries.push(FileEntry { name: entry.file_name().to_string_lossy().into_owned(), path: entry.path().to_string_lossy().into_owned(), directory });
    }
    entries.sort_by(|a, b| b.directory.cmp(&a.directory).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(DirectoryListing { path: path.to_string_lossy().into_owned(), parent: path.parent().map(|p| p.to_string_lossy().into_owned()), entries })
}

#[tauri::command]
fn preview_file(path: String) -> Result<String, String> {
    const LIMIT: u64 = 1024 * 1024;
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() { return Err("This is not a regular file".into()); }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT { return Err("File is too large to preview (1 MB limit)".into()); }
    if bytes.contains(&0) { return Err("This file does not appear to be text".into()); }
    String::from_utf8(bytes).map_err(|_| "This file is not UTF-8 text".into())
}


#[derive(serde::Serialize)]
struct ImagePreview { data: Vec<u8>, mime: &'static str }

#[tauri::command]
fn preview_image(path: String) -> Result<ImagePreview, String> {
    const LIMIT: u64 = 10 * 1024 * 1024;
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() { return Err("This is not a regular file".into()); }
    let mut data = Vec::new();
    file.take(LIMIT + 1).read_to_end(&mut data).map_err(|e| e.to_string())?;
    if data.len() as u64 > LIMIT { return Err("Image is too large to preview (10 MB limit)".into()); }
    let mime = if data.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
        else if data.starts_with(b"\xff\xd8\xff") { "image/jpeg" }
        else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") { "image/gif" }
        else if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" { "image/webp" }
        else { return Err("Unsupported image format".into()); };
    Ok(ImagePreview { data, mime })
}



#[tauri::command]
fn save_markdown(path: String, original: String, content: String) -> Result<(), String> {
    save_markdown_with(std::path::Path::new(&path), &original, |file| file.write_all(content.as_bytes()))
}

fn save_markdown_with(
    path: &std::path::Path,
    original: &str,
    write: impl FnOnce(&mut std::fs::File) -> std::io::Result<()>,
) -> Result<(), String> {
    let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "md" | "markdown" | "mdown") { return Err("Only Markdown files can be saved here".into()); }
    // Resolve links first so replacing the file preserves a symlink used to open it.
    let target = path.canonicalize().map_err(|e| e.to_string())?;
    let metadata = std::fs::metadata(&target).map_err(|e| e.to_string())?;
    if !metadata.is_file() { return Err("This is not a regular file".into()); }
    if metadata.permissions().readonly() { return Err("The file is read-only".into()); }
    let current = std::fs::read_to_string(&target).map_err(|e| e.to_string())?;
    if current != original { return Err("The file changed on disk. Reopen it before saving to avoid overwriting those changes.".into()); }

    let parent = target.parent().ok_or("Invalid file path")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("Cannot prepare file save: {e}"))?;
    write(temp.as_file_mut()).map_err(|e| format!("Cannot write file: {e}"))?;
    temp.as_file().set_permissions(metadata.permissions()).map_err(|e| format!("Cannot preserve file permissions: {e}"))?;
    temp.as_file().sync_all().map_err(|e| format!("Cannot finish file save: {e}"))?;

    // Writing the temporary file may take time; recheck before committing it.
    let current = std::fs::read_to_string(&target).map_err(|e| e.to_string())?;
    if current != original { return Err("The file changed on disk. Reopen it before saving to avoid overwriting those changes.".into()); }
    temp.persist(&target).map_err(|e| format!("Cannot replace file: {}", e.error))?;
    Ok(())
}

#[tauri::command]
fn resolve_file_link(path: String, cwd: Option<String>) -> Result<String, String> {
    let input = std::path::PathBuf::from(path);
    let resolved = if input.is_absolute() { input } else { std::path::PathBuf::from(cwd.or_else(|| std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok()).ok_or("Cannot resolve a relative path without a working folder")?).join(input) };
    let resolved = resolved.canonicalize().map_err(|e| e.to_string())?;
    if !resolved.is_file() { return Err("The link does not point to a file".into()); }
    Ok(resolved.to_string_lossy().into_owned())
}

#[cfg(test)]
mod file_workflow_tests {
    use super::*;
    #[test]
    fn image_preview_checks_signatures_and_size() {
        let folder = std::env::temp_dir().join(format!("cubicle-image-test-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join("image.png");
        std::fs::write(&file, b"\x89PNG\r\n\x1a\nvalid").unwrap();
        assert_eq!(preview_image(file.to_string_lossy().into_owned()).unwrap().mime, "image/png");
        std::fs::write(&file, b"<svg onload=alert(1)>").unwrap();
        assert!(preview_image(file.to_string_lossy().into_owned()).is_err());
        std::fs::write(&file, vec![0u8; 10 * 1024 * 1024 + 1]).unwrap();
        assert!(preview_image(file.to_string_lossy().into_owned()).is_err());
        assert!(preview_image(folder.to_string_lossy().into_owned()).is_err());
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(folder).unwrap();
    }
    #[test]
    fn resolves_relative_links_and_rejects_stale_saves() {
        let folder = std::env::temp_dir().join(format!("cubicle-file-test-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join("sample.md");
        std::fs::write(&file, "# Before\n").unwrap();
        let path = resolve_file_link("sample.md".into(), Some(folder.to_string_lossy().into_owned())).unwrap();
        save_markdown(path.clone(), "# Before\n".into(), "# After\n".into()).unwrap();
        assert!(save_markdown(path, "# Before\n".into(), "lost".into()).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "# After\n");
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(folder).unwrap();
    }

    #[test]
    fn a_partial_write_failure_preserves_the_original_and_removes_the_temp_file() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("sample.md");
        std::fs::write(&path, "# Original\n").unwrap();
        let result = save_markdown_with(&path, "# Original\n", |file| {
            file.write_all(b"# Partial")?;
            Err(std::io::Error::new(std::io::ErrorKind::Other, "simulated write failure"))
        });
        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# Original\n");
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_change_during_save_is_not_overwritten() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("sample.md");
        std::fs::write(&path, "# Original\n").unwrap();
        let result = save_markdown_with(&path, "# Original\n", |file| {
            file.write_all(b"# Cubicle edit\n")?;
            std::fs::write(&path, "# External edit\n")
        });
        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# External edit\n");
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn atomic_save_preserves_symlinks_and_file_permissions() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("sample.md");
        let link = folder.path().join("linked.md");
        std::fs::write(&path, "# Original\n").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        symlink(&path, &link).unwrap();

        save_markdown(link.to_string_lossy().into_owned(), "# Original\n".into(), "# Updated\n".into()).unwrap();

        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "# Updated\n");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o640);
    }
}

#[cfg(all(test, target_os = "linux"))]
mod terminal_directory_tests {
    use super::*;
    use std::io::BufRead;
    use std::process::{Command, Stdio};

    #[test]
    fn tracks_the_shell_directory_after_cd() {
        let directory = tempfile::tempdir().unwrap();
        let mut shell = Command::new("sh").args(["-c", "cd \"$1\" && echo ready && read line", "sh"]).arg(directory.path()).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        let mut line = String::new();
        std::io::BufReader::new(shell.stdout.take().unwrap()).read_line(&mut line).unwrap();
        assert_eq!(line.trim(), "ready");
        assert_eq!(linux_process_directory(shell.id()).as_deref(), directory.path().to_str());
        drop(shell.stdin.take());
        shell.wait().unwrap();
    }
}

#[cfg(test)]
mod hook_config_tests {
    use super::*;

    #[test]
    fn installation_preserves_settings_and_existing_hooks_for_each_provider() {
        for provider in ["Codex", "Claude", "Gemini"] {
            let folder = tempfile::tempdir().unwrap();
            let path = folder.path().join("settings.json");
            let script = folder.path().join("hook script.sh");
            let before = serde_json::json!({"theme":"dark", "permissions":{"allow":["example"]}, "hooks":{"SessionStart":[{"matcher":"resume", "hooks":[{"type":"command","command":"existing"}]}], "Stop":[{"hooks":[{"type":"command","command":"stop"}]}]}});
            std::fs::write(&path, serde_json::to_vec(&before).unwrap()).unwrap();
            install_session_hook(&path, &script, provider).unwrap();
            let after = read_hook_config(&path).unwrap();
            assert_eq!(after["theme"], before["theme"]);
            assert_eq!(after["permissions"], before["permissions"]);
            assert_eq!(after["hooks"]["Stop"], before["hooks"]["Stop"]);
            assert_eq!(after["hooks"]["SessionStart"][0], before["hooks"]["SessionStart"][0]);
            assert!(hook_present(&after, &hook_command(provider, &script)));
            assert_eq!(after["hooks"]["SessionStart"].as_array().unwrap().len(), 2);
            let written = std::fs::read(&path).unwrap();
            install_session_hook(&path, &script, provider).unwrap();
            assert_eq!(std::fs::read(&path).unwrap(), written);
        }
    }

    #[test]
    fn restricted_hooks_do_not_count_and_bad_configs_are_not_overwritten() {
        let command = "cubicle hook";
        let restricted = serde_json::json!({"hooks":{"SessionStart":[{"matcher":"resume", "hooks":[{"type":"command","command":command}]}]}});
        assert!(!hook_present(&restricted, command));
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("settings.json");
        let script = folder.path().join("hook.sh");
        for invalid in ["{ invalid", "{\"hooks\": \"bad\"}", "{\"hooks\": {\"SessionStart\": {}}}"] {
            std::fs::write(&path, invalid).unwrap();
            assert!(install_session_hook(&path, &script, "Codex").is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), invalid);
        }
    }
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) { app.restart(); }

#[cfg(test)]
mod terminal_input_tests {
    use super::*;
    use std::{future::Future, sync::mpsc, task::{Context, Poll, Wake, Waker}, time::Duration};

    struct BlockingWriter {
        started: mpsc::Sender<()>,
        release: mpsc::Receiver<()>,
    }
    impl Write for BlockingWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            let _ = self.started.send(());
            self.release.recv_timeout(Duration::from_secs(5))
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::TimedOut, e))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }

    struct ReportingWriter(mpsc::Sender<Vec<u8>>);
    impl Write for ReportingWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.send(bytes.to_vec())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::BrokenPipe, e))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }

    struct NoopWake;
    impl Wake for NoopWake {
        fn wake(self: Arc<Self>) {}
    }

    #[test]
    fn a_blocked_input_yields_and_does_not_block_another_terminal() {
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let writer: TerminalWriter = Arc::new(Mutex::new(Box::new(BlockingWriter {
            started: started_tx, release: release_rx,
        })));
        let mut blocked = Box::pin(write_terminal_input(writer, "blocked".into()));
        let waker = Waker::from(Arc::new(NoopWake));
        let yielded = matches!(blocked.as_mut().poll(&mut Context::from_waker(&waker)), Poll::Pending);
        let started = started_rx.recv_timeout(Duration::from_secs(2));

        let (bytes_tx, bytes_rx) = mpsc::channel();
        let other_writer: TerminalWriter = Arc::new(Mutex::new(Box::new(ReportingWriter(bytes_tx))));
        let other = tauri::async_runtime::spawn(write_terminal_input(other_writer, "other".into()));
        let bytes = bytes_rx.recv_timeout(Duration::from_secs(2));
        // Always release the worker before asserting, including on failure.
        let _ = release_tx.send(());
        if yielded { tauri::async_runtime::block_on(blocked).unwrap(); }
        tauri::async_runtime::block_on(other).unwrap().unwrap();

        assert!(yielded, "polling terminal input must not block the caller");
        assert!(started.is_ok(), "the blocking writer did not start");
        assert_eq!(bytes.unwrap(), b"other");
    }
}
