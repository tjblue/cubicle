use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Rect, Size, WebviewBuilder, WebviewUrl};
use serde::Serialize;

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
    view.hide().map_err(|e| e.to_string())
}
#[tauri::command]
pub fn browser_position(app: AppHandle, id: String, x: i32, y: i32, w: u32, h: u32, visible: bool) -> Result<(), String> {
    if let Some(view) = app.get_webview(&label(&id)) {
        if visible && w > 1 && h > 1 {
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
