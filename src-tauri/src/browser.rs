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
    if !matches!(url.scheme(), "http" | "https") { return Err("Only HTTP and HTTPS addresses are supported".into()); }
    Ok(url)
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
