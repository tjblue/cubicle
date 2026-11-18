//! Management of the shared, unprivileged WebView2 browser profile.
use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct SitePermission { origin: String, kind: i32, state: i32 }

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use std::{sync::mpsc, time::Duration};
    use tauri::Manager;
    use webview2_com::{take_pwstr, ClearBrowsingDataCompletedHandler, GetNonDefaultPermissionSettingsCompletedHandler, SetPermissionStateCompletedHandler};
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::core::{Interface, HSTRING, PWSTR};

    fn browser(app: &AppHandle) -> Result<tauri::Webview, String> {
        app.webviews().into_iter().find(|(label, _)| label.starts_with("browser-")).map(|(_, view)| view)
            .ok_or_else(|| "Open a browser pane before managing its site settings.".into())
    }
    async fn wait<T: Send + 'static>(rx: mpsc::Receiver<Result<T, String>>) -> Result<T, String> {
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(30)).map_err(|_| "WebView2 did not complete the request.".to_string())?).await.map_err(|e| e.to_string())?
    }
    pub async fn list(app: AppHandle) -> Result<Vec<SitePermission>, String> {
        let (tx, rx) = mpsc::channel();
        browser(&app)?.with_webview(move |platform| unsafe {
            let result = (|| -> windows::core::Result<()> {
                let profile = platform.controller().CoreWebView2()?.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile4>()?;
                let done = tx.clone();
                let handler = GetNonDefaultPermissionSettingsCompletedHandler::create(Box::new(move |status, items| {
                    let result = (|| -> Result<Vec<SitePermission>, String> {
                        status.map_err(|e| e.to_string())?;
                        let items = items.ok_or("WebView2 returned no permission list")?;
                        let mut count = 0; items.Count(&mut count).map_err(|e| e.to_string())?;
                        let mut out = Vec::new();
                        for i in 0..count {
                            let item = items.GetValueAtIndex(i).map_err(|e| e.to_string())?;
                            let mut origin = PWSTR::null(); let mut kind = COREWEBVIEW2_PERMISSION_KIND::default(); let mut state = COREWEBVIEW2_PERMISSION_STATE::default();
                            item.PermissionOrigin(&mut origin).map_err(|e| e.to_string())?;
                            let origin = take_pwstr(origin);
                            item.PermissionKind(&mut kind).map_err(|e| e.to_string())?;
                            item.PermissionState(&mut state).map_err(|e| e.to_string())?;
                            out.push(SitePermission { origin, kind: kind.0, state: state.0 });
                        }
                        Ok(out)
                    })();
                    let _ = done.send(result); Ok(())
                }));
                profile.GetNonDefaultPermissionSettings(&handler)
            })();
            if let Err(e) = result { let _ = tx.send(Err(e.to_string())); }
        }).map_err(|e| e.to_string())?;
        wait(rx).await
    }
    pub async fn reset(app: AppHandle, origin: String, kind: i32) -> Result<(), String> {
        let url = tauri::Url::parse(&origin).map_err(|_| "Invalid origin")?;
        if !matches!(url.scheme(), "http" | "https") || url.origin().ascii_serialization() != origin.trim_end_matches('/') { return Err("Invalid site origin".into()); }
        if !(1..=12).contains(&kind) { return Err("Unsupported permission kind".into()); }
        let (tx, rx) = mpsc::channel();
        browser(&app)?.with_webview(move |platform| unsafe {
            let result = (|| -> windows::core::Result<()> {
                let profile = platform.controller().CoreWebView2()?.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile4>()?;
                let done = tx.clone();
                let handler = SetPermissionStateCompletedHandler::create(Box::new(move |status| { let _ = done.send(status.map_err(|e| e.to_string())); Ok(()) }));
                profile.SetPermissionState(COREWEBVIEW2_PERMISSION_KIND(kind), &HSTRING::from(origin), COREWEBVIEW2_PERMISSION_STATE_DEFAULT, &handler)
            })();
            if let Err(e) = result { let _ = tx.send(Err(e.to_string())); }
        }).map_err(|e| e.to_string())?;
        wait(rx).await
    }
    pub async fn clear(app: AppHandle, category: String) -> Result<(), String> {
        let kinds = match category.as_str() {
            "site" => COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_SITE,
            "cache" => COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
            _ => return Err("Unknown browsing data category".into()),
        };
        let (tx, rx) = mpsc::channel();
        browser(&app)?.with_webview(move |platform| unsafe {
            let result = (|| -> windows::core::Result<()> {
                let profile = platform.controller().CoreWebView2()?.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile2>()?;
                let done = tx.clone();
                let handler = ClearBrowsingDataCompletedHandler::create(Box::new(move |status| { let _ = done.send(status.map_err(|e| e.to_string())); Ok(()) }));
                profile.ClearBrowsingData(kinds, &handler)
            })();
            if let Err(e) = result { let _ = tx.send(Err(e.to_string())); }
        }).map_err(|e| e.to_string())?;
        wait(rx).await
    }
}

#[tauri::command]
pub async fn browser_permissions_list(app: AppHandle) -> Result<Vec<SitePermission>, String> {
    #[cfg(windows)] { windows_impl::list(app).await }
    #[cfg(not(windows))] { let _ = app; Err("Site settings are available on Windows only.".into()) }
}
#[tauri::command]
pub async fn browser_permission_reset(app: AppHandle, origin: String, kind: i32) -> Result<(), String> {
    #[cfg(windows)] { windows_impl::reset(app, origin, kind).await }
    #[cfg(not(windows))] { let _ = (app, origin, kind); Err("Site settings are available on Windows only.".into()) }
}
#[tauri::command]
pub async fn browser_data_clear(app: AppHandle, category: String) -> Result<(), String> {
    #[cfg(windows)] { windows_impl::clear(app, category).await }
    #[cfg(not(windows))] { let _ = (app, category); Err("Browsing-data clearing is available on Windows only.".into()) }
}
