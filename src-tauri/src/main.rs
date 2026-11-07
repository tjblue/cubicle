#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod browser;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{collections::HashMap, io::{Read, Write}, sync::Mutex, thread};
use tauri::{ipc::Channel, Emitter, Manager, State};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct Terminals(Mutex<HashMap<String, Session>>);

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
    let mut command = CommandBuilder::new(shell.as_deref().filter(|s| !s.trim().is_empty()).unwrap_or(&default_shell));
    command.env("TERM", "xterm-256color");
    if let Some(env) = env { for (key, value) in env { command.env(key, value); } }
    if let Some(path) = cwd {
        let validated = validate_directory(path)?;
        command.cwd(display_windows_path(&validated));
    } else if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) { command.cwd(home); }
    let mut child = pair.slave.spawn_command(command).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| { let _ = child.kill(); e.to_string() })?;
    let writer = pair.master.take_writer().map_err(|e| { let _ = child.kill(); e.to_string() })?;
    sessions.insert(id.clone(), Session { master: pair.master, writer, child });
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
fn terminal_write(terminals: State<'_, Terminals>, id: String, data: String) -> Result<(), String> {
    let mut sessions = terminals.0.lock().map_err(|e| e.to_string())?;
    let session = sessions.get_mut(&id).ok_or("Terminal is not running")?;
    session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn terminal_default_cwd() -> Option<String> {
    std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok()
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

// PowerShell displays verbatim Windows paths as provider-qualified paths.
fn display_windows_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") { format!(r"\\{}", rest) }
    else if let Some(rest) = path.strip_prefix(r"\\?\") {
        if rest.as_bytes().get(1) == Some(&b':') { rest.to_string() } else { path.to_string() }
    } else { path.to_string() }
}

#[tauri::command]
fn terminal_clipboard_read() -> Result<String, String> {
    #[cfg(windows)]
    { clipboard_win::get_clipboard(clipboard_win::formats::Unicode).map_err(|e| e.to_string()) }
    #[cfg(not(windows))]
    { Err("Clipboard is unavailable on this platform".into()) }
}

#[tauri::command]
fn terminal_clipboard_write(text: String) -> Result<(), String> {
    #[cfg(windows)]
    { clipboard_win::set_clipboard(clipboard_win::formats::Unicode, text).map_err(|e| e.to_string()) }
    #[cfg(not(windows))]
    { let _ = text; Err("Clipboard is unavailable on this platform".into()) }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HookConfigStatus { provider: String, path: String, state: String, detail: String }

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

fn hook_paths() -> Result<Vec<(&'static str, std::path::PathBuf)>, String> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).ok_or("Home directory is unavailable")?;
    let home = std::path::PathBuf::from(home);
    let codex = std::env::var_os("CODEX_HOME").map(std::path::PathBuf::from).unwrap_or_else(|| home.join(".codex"));
    let claude = std::env::var_os("CLAUDE_CONFIG_DIR").map(std::path::PathBuf::from).unwrap_or_else(|| home.join(".claude"));
    Ok(vec![("Codex", codex.join("hooks.json")), ("Claude", claude.join("settings.json")), ("Gemini", home.join(".gemini").join("settings.json"))])
}
fn hook_script_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe.parent().ok_or("App directory is unavailable")?.join("dockview-session-start-hook.ps1"))
}
fn hook_command(provider: &str, script: &std::path::Path) -> String {
    format!("powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"{}\" -Provider {}", script.display(), provider.to_lowercase())
}
fn read_hook_config(path: &std::path::Path) -> Result<serde_json::Value, String> {
    match std::fs::read(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(format!("Cannot read configuration: {e}")),
        Ok(bytes) => serde_json::from_slice(bytes.strip_prefix(&[0xef,0xbb,0xbf]).unwrap_or(&bytes)).map_err(|e| format!("Invalid JSON: {e}")),
    }
}
fn hook_present(config: &serde_json::Value, command: &str) -> bool {
    config.get("hooks").and_then(|v| v.get("SessionStart")).and_then(|v| v.as_array()).is_some_and(|groups| groups.iter().any(|group| group.get("hooks").and_then(|v| v.as_array()).is_some_and(|hooks| hooks.iter().any(|hook| hook.get("type").and_then(|v| v.as_str()) == Some("command") && hook.get("command").and_then(|v| v.as_str()) == Some(command)))))
}
fn add_session_hook(config: &mut serde_json::Value, command: &str) -> Result<bool, String> {
    if hook_present(config, command) { return Ok(false); }
    let root = config.as_object_mut().ok_or("Configuration must be a JSON object")?;
    let hooks = root.entry("hooks").or_insert_with(|| serde_json::json!({})).as_object_mut().ok_or("hooks must be a JSON object")?;
    let starts = hooks.entry("SessionStart").or_insert_with(|| serde_json::json!([])).as_array_mut().ok_or("SessionStart must be an array")?;
    let mut handler = serde_json::json!({"type": "command", "command": command});
    if command.ends_with(" -Provider codex") { handler["async"] = serde_json::Value::Bool(true); }
    starts.push(serde_json::json!({"hooks": [handler]}));
    Ok(true)
}
#[tauri::command]
fn chat_resume_hook_status() -> Result<Vec<HookConfigStatus>, String> {
    let script = hook_script_path()?;
    let script_ok = std::fs::read_to_string(&script).is_ok_and(|s| s == HOOK_SCRIPT);
    Ok(hook_paths()?.into_iter().map(|(provider, path)| {
        let command = hook_command(provider, &script);
        let (state, detail) = match read_hook_config(&path) {
            Err(e) => ("error", e),
            Ok(mut config) => match add_session_hook(&mut config, &command) {
                Err(e) => ("error", e),
                Ok(false) if script_ok => ("installed", "Hook configured. Codex may require hook trust review.".into()),
                Ok(false) => ("missing", "Hook script is missing or changed; repair is required.".into()),
                Ok(true) => ("missing", "Dockview hook not configured.".into()),
            },
        };
        HookConfigStatus { provider: provider.into(), path: path.to_string_lossy().into_owned(), state: state.into(), detail }
    }).collect())
}
// Read only events written by configured Dockview hooks. The bounded tail avoids loading chat history.
#[tauri::command]
fn chat_resume_recent_hooks() -> Result<Vec<serde_json::Value>, String> {
    use std::io::{Seek, SeekFrom};
    let mut logs = std::collections::HashSet::new();
    for (_, path) in hook_paths()? {
        let config = match read_hook_config(&path) { Ok(v) => v, Err(_) => continue };
        if let Some(groups) = config.pointer("/hooks/SessionStart").and_then(|v| v.as_array()) {
            for group in groups { if let Some(items) = group.get("hooks").and_then(|v| v.as_array()) { for item in items {
                if let Some(cmd) = item.get("command").and_then(|v| v.as_str()) {
                    if let Some(script) = cmd.split('"').nth(1) {
                        let script = std::path::Path::new(script);
                        if script.file_name().is_some_and(|v| v == "dockview-session-start-hook.ps1") {
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
    if !cfg!(windows) { return Err("This temporary hook is available on Windows only".into()); }
    let path = hook_paths()?.into_iter().find(|(name, _)| *name == provider).ok_or("Unknown CLI")?.1;
    let script = hook_script_path()?;
    let mut config = read_hook_config(&path)?;
    let changed = add_session_hook(&mut config, &hook_command(&provider, &script))?;
    if let Ok(existing) = std::fs::read_to_string(&script) { if existing != HOOK_SCRIPT { return Err("The Dockview hook script has been modified; it was not overwritten.".into()); } }
    else if script.exists() { return Err("Cannot read the existing Dockview hook script".into()); }
    else { std::fs::write(&script, HOOK_SCRIPT).map_err(|e| format!("Cannot write hook script: {e}"))?; }
    if changed {
        let parent = path.parent().ok_or("Invalid configuration path")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let json = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| format!("Cannot prepare configuration update: {e}"))?;
        temp.write_all(&json).and_then(|_| temp.as_file().sync_all()).map_err(|e| format!("Cannot write configuration: {e}"))?;
        temp.persist(&path).map_err(|e| format!("Cannot update {}: {}", path.display(), e.error))?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
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
        .invoke_handler(tauri::generate_handler![terminal_start, terminal_write, terminal_default_cwd, terminal_log_enter, terminal_resize, terminal_close, terminal_clipboard_read, terminal_clipboard_write, chat_resume_hook_status, chat_resume_recent_hooks, terminal_agent_kinds, chat_resume_install_hook, validate_directory, choose_space_folder, list_files, preview_file, save_markdown, resolve_file_link, browser::browser_create, browser::browser_position, browser::browser_navigate, browser::browser_action, browser::browser_close])
        .build(tauri::generate_context!())
        .expect("failed to build Dockview desktop")
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn session_hook_merge_preserves_existing_config_and_is_idempotent() {
        let mut config = serde_json::json!({"theme":"dark", "hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"existing"}]}], "Stop":[{"other":true}]}});
        assert_eq!(add_session_hook(&mut config, "dockview test").unwrap(), true);
        assert!(hook_present(&config, "dockview test"));
        assert_eq!(add_session_hook(&mut config, "dockview test").unwrap(), false);
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
                if String::from_utf8_lossy(&all).contains("DOCKVIEW_PTY_TEST") { break; }
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
                writer.write_all(b"echo DOCKVIEW_PTY_TEST\r\nexit\r\n").unwrap();
                writer.flush().unwrap();
                sent_command = true;
            }
            if received.contains("DOCKVIEW_PTY_TEST") { break; }
        }
        let _ = child.kill();
        assert!(received.contains("DOCKVIEW_PTY_TEST"), "command output did not arrive through the PTY: {received:?}");
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
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let mut picker = rfd::FileDialog::new().set_title("Choose a project folder");
            if let Some(path) = initial_path.filter(|path| std::path::Path::new(path).is_dir()) {
                picker = picker.set_directory(path);
            }
            Ok(picker.pick_folder().map(|path| path.to_string_lossy().into_owned()))
        }).await.map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = initial_path;
        Err("The folder picker is only available on Windows".into())
    }
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



#[tauri::command]
fn save_markdown(path: String, original: String, content: String) -> Result<(), String> {
    let target = std::path::Path::new(&path);
    let extension = target.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "md" | "markdown" | "mdown") { return Err("Only Markdown files can be saved here".into()); }
    let current = std::fs::read_to_string(target).map_err(|e| e.to_string())?;
    if current != original { return Err("The file changed on disk. Reopen it before saving to avoid overwriting those changes.".into()); }
    std::fs::write(target, content).map_err(|e| e.to_string())
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
    fn resolves_relative_links_and_rejects_stale_saves() {
        let folder = std::env::temp_dir().join(format!("dockview-file-test-{}", std::process::id()));
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
}
