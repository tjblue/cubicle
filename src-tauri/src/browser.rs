use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewBuilder, WebviewUrl};
#[cfg(not(target_os = "linux"))]
use tauri::{Position, Rect, Size};
use serde::Serialize;
#[cfg(target_os = "linux")]
use gtk::prelude::*;

#[derive(Clone, Serialize)]
pub(crate) struct BrowserEvent { pub id: String, pub kind: &'static str, pub value: String }
fn label(id: &str) -> String { format!("browser-{id}") }
fn web_url(url: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(url).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https" | "file") { return Err("Only HTTP, HTTPS, and file addresses are supported".into()); }
    Ok(url)
}
#[tauri::command]
pub fn browser_file_url(path: String) -> Result<String, String> {
    let path = std::path::PathBuf::from(path).canonicalize().map_err(|e| e.to_string())?;
    if !path.is_file() || !path.extension().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case("html") || s.eq_ignore_ascii_case("htm")) {
        return Err("Choose an HTML file".into());
    }
    #[cfg(windows)]
    let path = {
        let text = path.to_string_lossy();
        if let Some(unc) = text.strip_prefix(r"\\?\UNC\") { std::path::PathBuf::from(format!(r"\\{unc}")) }
        else if let Some(local) = text.strip_prefix(r"\\?\") { std::path::PathBuf::from(local) }
        else { path.clone() }
    };
    tauri::Url::from_file_path(&path).map(|url| url.to_string()).map_err(|_| "Cannot convert path to a file URL".into())
}

#[tauri::command]
pub async fn browser_create(app: AppHandle, id: String, url: String) -> Result<(), String> {
    let parsed = web_url(&url)?;
    let nav_app = app.clone(); let nav_id = id.clone();
    let title_app = app.clone(); let title_id = id.clone();
    let builder = WebviewBuilder::new(label(&id), WebviewUrl::External(parsed))
        .use_https_scheme(true)
        .initialization_script(r#"(() => {
          let last = '';
          const report = () => {
            const link = document.querySelector('link[rel~="icon" i]');
            const icon = link?.href || new URL('/favicon.ico', location.href).href;
            if (icon === last) return;
            last = icon;
            fetch('https://browsermeta.localhost/icon', { method: 'POST', mode: 'no-cors', body: icon }).catch(() => {});
          };
          document.addEventListener('DOMContentLoaded', report);
          new MutationObserver(report).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['href', 'rel'] });
        })();"#)
        .on_page_load(move |_, p| { if matches!(p.event(), tauri::webview::PageLoadEvent::Started) { let _ = nav_app.emit("browser-event", BrowserEvent { id: nav_id.clone(), kind: "url", value: p.url().to_string() }); } })
        .on_document_title_changed(move |_, title| { let _ = title_app.emit("browser-event", BrowserEvent { id: title_id.clone(), kind: "title", value: title }); });
    // Keep extensions and browsing data away from Cubicle's privileged UI webview.
    #[cfg(windows)]
    let builder = builder
        .data_directory(app.path().app_data_dir().map_err(|e| e.to_string())?.join("browser-profile"))
        .browser_extensions_enabled(true);
    let window = app.get_window("main").ok_or("Main window not found")?;
    let view = window.add_child(builder, PhysicalPosition::new(0, 0), PhysicalSize::new(1u32, 1u32)).map_err(|e| e.to_string())?;
    view.hide().map_err(|e| e.to_string())?;
    // On Linux Tauri puts child webviews into a GtkBox, which ignores their
    // requested bounds. Use an overlay so each browser can occupy its pane.
    #[cfg(target_os = "linux")]
    view.with_webview(|platform| {
        let child = platform.inner();
        let Some(parent) = child.parent().and_then(|p| p.downcast::<gtk::Box>().ok()) else { return };
        parent.remove(&child);
        let overlay = parent.children().into_iter().find_map(|widget| {
            let overlay = widget.downcast::<gtk::Overlay>().ok()?;
            (overlay.widget_name() == "cubicle-browser-overlay").then_some(overlay)
        }).unwrap_or_else(|| {
            let main = parent.children().into_iter().next().expect("main webview missing");
            parent.remove(&main);
            let overlay = gtk::Overlay::new();
            overlay.set_widget_name("cubicle-browser-overlay");
            overlay.add(&main);
            parent.pack_start(&overlay, true, true, 0);
            overlay.show_all();
            overlay
        });
        child.set_halign(gtk::Align::Start);
        child.set_valign(gtk::Align::Start);
        overlay.add_overlay(&child);
    }).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn browser_position(app: AppHandle, id: String, x: i32, y: i32, w: u32, h: u32, visible: bool) -> Result<(), String> {
    if let Some(view) = app.get_webview(&label(&id)) {
        if visible && w > 1 && h > 1 {
            #[cfg(target_os = "linux")]
            view.with_webview(move |platform| {
                let child = platform.inner();
                let scale = child.scale_factor().max(1);
                child.set_margin_start(x.max(0) / scale);
                child.set_margin_top(y.max(0) / scale);
                child.set_size_request((w as i32) / scale, (h as i32) / scale);
            }).map_err(|e| e.to_string())?;
            #[cfg(not(target_os = "linux"))]
            view.set_bounds(Rect { position: Position::Physical(PhysicalPosition::new(x, y)), size: Size::Physical(PhysicalSize::new(w, h)) }).map_err(|e| e.to_string())?;
            view.show().map_err(|e| e.to_string())?;
        } else { view.hide().map_err(|e| e.to_string())?; }
    }
    Ok(())
}
#[tauri::command]
pub fn browser_navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
    app.get_webview(&label(&id)).ok_or("Browser not found")?.navigate(web_url(&url)?).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn browser_action(app: AppHandle, id: String, action: String) -> Result<(), String> {
    let script = match action.as_str() { "back" => "history.back()", "forward" => "history.forward()", "reload" => "location.reload()", _ => return Err("Unknown action".into()) };
    app.get_webview(&label(&id)).ok_or("Browser not found")?.eval(script).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn browser_close(app: AppHandle, id: String) -> Result<(), String> {
    if let Some(view) = app.get_webview(&label(&id)) { view.close().map_err(|e| e.to_string())?; }
    Ok(())
}

#[cfg(windows)]
mod extensions_runtime {
    use super::*;
    use std::{path::PathBuf, sync::mpsc, time::Duration};
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, take_pwstr, ProfileAddBrowserExtensionCompletedHandler, ProfileGetBrowserExtensionsCompletedHandler, BrowserExtensionEnableCompletedHandler, BrowserExtensionRemoveCompletedHandler};
    use windows::core::{Interface, HSTRING, PWSTR};

    fn view(app: &AppHandle) -> Result<tauri::Webview, String> {
        app.webviews().into_iter().find(|(label, _)| label.starts_with("browser-")).map(|(_, view)| view)
            .ok_or_else(|| "Open a browser pane before managing extensions.".into())
    }

    async fn wait<T: Send + 'static>(rx: mpsc::Receiver<Result<T, String>>) -> Result<T, String> {
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(30)).map_err(|_| "WebView2 did not complete the extension operation.".to_string())?).await.map_err(|e| e.to_string())?
    }

    pub async fn list(app: AppHandle) -> Result<Vec<(String, bool)>, String> {
        let view = view(&app)?;
        let (tx, rx) = mpsc::channel();
        view.with_webview(move |platform| unsafe {
            let result = (|| -> windows::core::Result<()> {
                let profile = platform.controller().CoreWebView2()?.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile7>()?;
                let done = tx.clone();
                let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |status, list| {
                    let result = (|| -> Result<Vec<(String, bool)>, String> {
                        status.map_err(|e| e.to_string())?;
                        let list = list.ok_or("WebView2 returned no extension list")?;
                        let mut count = 0; list.Count(&mut count).map_err(|e| e.to_string())?;
                        let mut items = Vec::new();
                        for index in 0..count {
                            let ext = list.GetValueAtIndex(index).map_err(|e| e.to_string())?;
                            let mut id = PWSTR::null(); ext.Id(&mut id).map_err(|e| e.to_string())?;
                            let mut enabled = windows::core::BOOL(0); ext.IsEnabled(&mut enabled).map_err(|e| e.to_string())?;
                            items.push((take_pwstr(id), enabled.as_bool()));
                        }
                        Ok(items)
                    })();
                    let _ = done.send(result); Ok(())
                }));
                profile.GetBrowserExtensions(&handler)
            })();
            if let Err(e) = result { let _ = tx.send(Err(e.to_string())); }
        }).map_err(|e| e.to_string())?;
        wait(rx).await
    }

    pub async fn install(app: AppHandle, path: PathBuf) -> Result<String, String> {
        let view = view(&app)?;
        let (tx, rx) = mpsc::channel();
        view.with_webview(move |platform| unsafe {
            let result = (|| -> windows::core::Result<()> {
                let core = platform.controller().CoreWebView2()?;
                let profile = core.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile7>()?;
                let tx_done = tx.clone();
                let handler = ProfileAddBrowserExtensionCompletedHandler::create(Box::new(move |status, extension| {
                    let result = status.map_err(|e| e.to_string()).and_then(|_| {
                        let ext = extension.ok_or_else(|| "WebView2 returned no extension.".to_string())?;
                        let mut id = PWSTR::null();
                        ext.Id(&mut id).map_err(|e| e.to_string())?;
                        Ok(take_pwstr(id))
                    });
                    let _ = tx_done.send(result);
                    Ok(())
                }));
                profile.AddBrowserExtension(&HSTRING::from(path.as_path()), &handler)
            })();
            if let Err(e) = result { let _ = tx.send(Err(e.to_string())); }
        }).map_err(|e| e.to_string())?;
        wait(rx).await
    }

    pub async fn change(app: AppHandle, id: String, enabled: Option<bool>) -> Result<(), String> {
        let view = view(&app)?;
        let (tx, rx) = mpsc::channel();
        view.with_webview(move |platform| unsafe {
            let result = (|| -> windows::core::Result<()> {
                let core = platform.controller().CoreWebView2()?;
                let profile = core.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile7>()?;
                let tx_list = tx.clone();
                let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |status, list| {
                    let action = (|| -> Result<(), String> {
                        status.map_err(|e| e.to_string())?;
                        let list = list.ok_or_else(|| "WebView2 returned no extension list.".to_string())?;
                        let mut count = 0; list.Count(&mut count).map_err(|e| e.to_string())?;
                        for index in 0..count {
                            let ext = list.GetValueAtIndex(index).map_err(|e| e.to_string())?;
                            let mut raw = PWSTR::null(); ext.Id(&mut raw).map_err(|e| e.to_string())?;
                            if take_pwstr(raw) != id { continue; }
                            let tx_done = tx_list.clone();
                            if let Some(value) = enabled {
                                let handler = BrowserExtensionEnableCompletedHandler::create(Box::new(move |result| { let _ = tx_done.send(result.map_err(|e| e.to_string())); Ok(()) }));
                                ext.Enable(value, &handler).map_err(|e| e.to_string())?;
                            } else {
                                let handler = BrowserExtensionRemoveCompletedHandler::create(Box::new(move |result| { let _ = tx_done.send(result.map_err(|e| e.to_string())); Ok(()) }));
                                ext.Remove(&handler).map_err(|e| e.to_string())?;
                            }
                            return Ok(());
                        }
                        Err("Extension is not installed in the browser profile.".into())
                    })();
                    if let Err(error) = action { let _ = tx_list.send(Err(error)); }
                    Ok(())
                }));
                profile.GetBrowserExtensions(&handler)
            })();
            if let Err(e) = result { let _ = tx.send(Err(e.to_string())); }
        }).map_err(|e| e.to_string())?;
        wait(rx).await
    }
}

#[cfg(windows)]
pub async fn runtime_list(app: AppHandle) -> Result<Vec<(String, bool)>, String> { extensions_runtime::list(app).await }
#[cfg(not(windows))]
pub async fn runtime_list(_: AppHandle) -> Result<Vec<(String, bool)>, String> { Err("Browser extensions are available on Windows only.".into()) }

#[cfg(windows)]
pub async fn runtime_install(app: AppHandle, path: std::path::PathBuf) -> Result<String, String> { extensions_runtime::install(app, path).await }
#[cfg(windows)]
pub async fn runtime_set_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> { extensions_runtime::change(app, id, Some(enabled)).await }
#[cfg(windows)]
pub async fn runtime_remove(app: AppHandle, id: String) -> Result<(), String> { extensions_runtime::change(app, id, None).await }
#[cfg(not(windows))]
pub async fn runtime_install(_: AppHandle, _: std::path::PathBuf) -> Result<String, String> { Err("Browser extensions are available on Windows only.".into()) }
#[cfg(not(windows))]
pub async fn runtime_set_enabled(_: AppHandle, _: String, _: bool) -> Result<(), String> { Err("Browser extensions are available on Windows only.".into()) }
#[cfg(not(windows))]
pub async fn runtime_remove(_: AppHandle, _: String) -> Result<(), String> { Err("Browser extensions are available on Windows only.".into()) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_file_url_round_trips_special_characters() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("hello # café.html");
        std::fs::write(&file, "<h1>Hello</h1>").unwrap();
        let url = browser_file_url(file.to_string_lossy().into_owned()).unwrap();
        assert!(url.contains("%23"));
        assert_eq!(web_url(&url).unwrap().to_file_path().unwrap().canonicalize().unwrap(), file.canonicalize().unwrap());
        assert!(browser_file_url(dir.path().to_string_lossy().into_owned()).is_err());
        assert!(web_url("javascript:alert(1)").is_err());
    }
}
