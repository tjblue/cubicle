//! WebView2 download tracking. WebView2 owns the transfer and its normal save UI.
use serde::Serialize;
use std::sync::{atomic::{AtomicU64, Ordering}, Mutex};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
pub struct Download {
    pub id: String,
    pub path: String,
    pub received: i64,
    pub total: i64,
    pub status: String,
    pub can_resume: bool,
}

#[derive(Default)]
pub struct Downloads {
    next: AtomicU64,
    items: Mutex<Vec<Download>>,
}

#[tauri::command]
pub fn browser_downloads_list(state: tauri::State<'_, Downloads>) -> Result<Vec<Download>, String> {
    state.items.lock().map(|items| items.clone()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_download_reveal(state: tauri::State<'_, Downloads>, id: String) -> Result<(), String> {
    let path = {
        let items = state.items.lock().map_err(|e| e.to_string())?;
        let item = items.iter().find(|item| item.id == id && item.status == "completed").ok_or("Completed download not found")?;
        std::path::PathBuf::from(&item.path)
    };
    if !path.is_file() { return Err("Downloaded file no longer exists".into()); }
    #[cfg(windows)]
    { std::process::Command::new("explorer.exe").arg("/select,").arg(path).spawn().map_err(|e| e.to_string())?; Ok(()) }
    #[cfg(not(windows))]
    { let _ = path; Err("Showing downloads in a folder is available on Windows only".into()) }
}

#[cfg(windows)]
mod windows_runtime {
    use super::*;
    use std::{cell::RefCell, collections::HashMap, sync::mpsc, time::Duration};
    use webview2_com::{take_pwstr, BytesReceivedChangedEventHandler, DownloadStartingEventHandler, StateChangedEventHandler};
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::core::{BOOL, Interface, PWSTR};

    thread_local! { static OPERATIONS: RefCell<HashMap<String, ICoreWebView2DownloadOperation>> = RefCell::new(HashMap::new()); }

    unsafe fn update(app: &AppHandle, id: &str, op: &ICoreWebView2DownloadOperation) -> windows::core::Result<()> {
        let mut path = PWSTR::null(); op.ResultFilePath(&mut path)?;
        let path = take_pwstr(path);
        let mut received = 0; let mut total = 0; let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default(); let mut resumable = BOOL(0);
        let mut reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON::default();
        op.BytesReceived(&mut received)?; op.TotalBytesToReceive(&mut total)?; op.State(&mut state)?;
        let _ = op.InterruptReason(&mut reason);
        let _ = op.CanResume(&mut resumable);
        let status = if state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED { "completed" } else if state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED && reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_PAUSED { "paused" } else if state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED { "interrupted" } else { "in_progress" };
        let item = Download { id: id.into(), path, received, total, status: status.into(), can_resume: resumable.as_bool() };
        let state = app.state::<Downloads>();
        if let Ok(mut items) = state.items.lock() {
            if let Some(existing) = items.iter_mut().find(|entry| entry.id == id) { *existing = item.clone(); } else { items.insert(0, item.clone()); }
        }
        let _ = app.emit_to("main", "browser-download", item);
        if status == "completed" || (status == "interrupted" && !resumable.as_bool()) { OPERATIONS.with(|ops| { ops.borrow_mut().remove(id); }); }
        Ok(())
    }

    pub fn attach(view: &tauri::Webview, app: AppHandle) -> Result<(), String> {
        let source_id = view.label().strip_prefix("browser-").map(str::to_owned);
        let error_app = app.clone();
        view.with_webview(move |platform| unsafe {
            let result = (|| -> windows::core::Result<()> {
                let core = platform.controller().CoreWebView2()?.cast::<ICoreWebView2_4>()?;
                let handler = DownloadStartingEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let op = args.DownloadOperation()?;
                    let id = app.state::<Downloads>().next.fetch_add(1, Ordering::Relaxed).to_string();
                    OPERATIONS.with(|ops| { ops.borrow_mut().insert(id.clone(), op.clone()); });
                    let changed_app = app.clone(); let changed_id = id.clone();
                    let bytes = BytesReceivedChangedEventHandler::create(Box::new(move |op, _| {
                        if let Some(op) = op { let _ = update(&changed_app, &changed_id, &op); } Ok(())
                    }));
                    let changed_app = app.clone(); let changed_id = id.clone();
                    let state = StateChangedEventHandler::create(Box::new(move |op, _| {
                        if let Some(op) = op { let _ = update(&changed_app, &changed_id, &op); } Ok(())
                    }));
                    let mut token = 0;
                    op.add_BytesReceivedChanged(&bytes, &mut token)?;
                    op.add_StateChanged(&state, &mut token)?;
                    update(&app, &id, &op)
                }));
                let mut token = 0;
                core.add_DownloadStarting(&handler, &mut token)
            })();
            if let Err(error) = result {
                if let Some(id) = source_id { let _ = error_app.emit_to("main", "browser-event", crate::browser::BrowserEvent { id, kind: "error", value: format!("Download tracking unavailable: {error}") }); }
            }
        }).map_err(|e| e.to_string())
    }

    pub async fn action(app: AppHandle, id: String, action: String) -> Result<(), String> {
        if !matches!(action.as_str(), "cancel" | "pause" | "resume") { return Err("Unknown download action".into()); }
        let (tx, rx) = mpsc::channel();
        let event_app = app.clone();
        app.run_on_main_thread(move || {
            let result = OPERATIONS.with(|ops| {
                let op = ops.borrow().get(&id).cloned().ok_or_else(|| "Download is no longer active".to_string())?;
                unsafe {
                    match action.as_str() { "cancel" => op.Cancel(), "pause" => op.Pause(), _ => op.Resume() }.map_err(|e| e.to_string())?;
                    let _ = update(&event_app, &id, &op);
                }
                Ok(())
            });
            let _ = tx.send(result);
        }).map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(10)).map_err(|_| "Download action timed out".to_string())?).await.map_err(|e| e.to_string())?
    }
}

#[cfg(windows)]
pub fn attach(view: &tauri::Webview, app: AppHandle) -> Result<(), String> { windows_runtime::attach(view, app) }
#[cfg(not(windows))]
pub fn attach(_: &tauri::Webview, _: AppHandle) -> Result<(), String> { Ok(()) }

#[tauri::command]
pub async fn browser_download_action(app: AppHandle, id: String, action: String) -> Result<(), String> {
    #[cfg(windows)] { windows_runtime::action(app, id, action).await }
    #[cfg(not(windows))] { let _ = (app, id, action); Err("Download controls are available on Windows only".into()) }
}
