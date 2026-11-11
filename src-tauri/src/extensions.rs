use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::Manager;
use std::sync::atomic::{AtomicBool, Ordering};

static MUTATING: AtomicBool = AtomicBool::new(false);
struct MutationGuard;
impl MutationGuard {
    fn acquire() -> Result<Self, String> {
        MUTATING.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed).map_err(|_| "Another extension operation is in progress".to_string())?;
        Ok(Self)
    }
}
impl Drop for MutationGuard { fn drop(&mut self) { MUTATING.store(false, Ordering::Release); } }

#[derive(Clone, Serialize, Deserialize)]
pub struct ExtensionInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub path: String,
    pub permissions: Vec<String>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_enabled: Option<bool>,
    #[serde(default)]
    pub runtime_missing: bool,
}

fn manifest_info(path: &Path, id: String) -> Result<ExtensionInfo, String> {
    let path = path.canonicalize().map_err(|e| format!("Cannot open extension folder: {e}"))?;
    let bytes = std::fs::read(path.join("manifest.json")).map_err(|e| format!("Cannot read manifest.json: {e}"))?;
    if bytes.len() > 2_000_000 { return Err("Extension manifest is too large".into()); }
    let manifest: Value = serde_json::from_slice(&bytes).map_err(|e| format!("Invalid extension manifest: {e}"))?;
    let locale = manifest["default_locale"].as_str().filter(|v| v.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
    let messages: Value = locale.and_then(|l| std::fs::read(path.join("_locales").join(l).join("messages.json")).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
    let field = |key: &str| -> String {
        let value = manifest[key].as_str().unwrap_or("");
        if let Some(message) = value.strip_prefix("__MSG_").and_then(|s| s.strip_suffix("__")) {
            messages.as_object().and_then(|m| m.iter().find(|(k, _)| k.eq_ignore_ascii_case(message))).and_then(|(_, v)| v["message"].as_str()).unwrap_or(value).to_string()
        } else { value.to_string() }
    };
    let name = field("name"); let version = field("version");
    if name.is_empty() || version.is_empty() || !matches!(manifest["manifest_version"].as_u64(), Some(2 | 3)) { return Err("Manifest must contain a name, version, and supported manifest version".into()); }
    let mut permissions = Vec::new();
    for key in ["permissions", "host_permissions", "optional_permissions", "optional_host_permissions"] {
        if let Some(values) = manifest[key].as_array() { for value in values { if let Some(value) = value.as_str() { if !permissions.iter().any(|p| p == value) { permissions.push(value.to_string()); } } } }
    }
    if let Some(scripts) = manifest["content_scripts"].as_array() {
        for script in scripts { if let Some(matches) = script["matches"].as_array() { for value in matches { if let Some(value) = value.as_str() { if !permissions.iter().any(|p| p == value) { permissions.push(value.to_string()); } } } } }
    }
    Ok(ExtensionInfo { id, name, version, description: field("description"), path: path.to_string_lossy().into_owned(), permissions, enabled: true, source: String::new(), runtime_enabled: None, runtime_missing: false })
}

fn storage(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("browser-extensions");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}
fn records_path(app: &tauri::AppHandle) -> Result<PathBuf, String> { Ok(storage(app)?.join("installed.json")) }
fn read_records(app: &tauri::AppHandle) -> Result<Vec<ExtensionInfo>, String> {
    let path = records_path(app)?;
    match std::fs::read(path) {
        Ok(data) => serde_json::from_slice(&data).map_err(|e| format!("Cannot read installed extensions: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}
fn write_records(app: &tauri::AppHandle, records: &[ExtensionInfo]) -> Result<(), String> {
    let root = storage(app)?;
    let mut file = tempfile::NamedTempFile::new_in(&root).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(&mut file, records).map_err(|e| e.to_string())?;
    file.persist(records_path(app)?).map_err(|e| e.error.to_string())?;
    Ok(())
}
fn copy_folder(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        if ty.is_symlink() { return Err("Extension folders containing symbolic links cannot be imported".into()); }
        if ty.is_dir() { copy_folder(&entry.path(), &to.join(entry.file_name()))?; }
        else if ty.is_file() { std::fs::copy(entry.path(), to.join(entry.file_name())).map_err(|e| e.to_string())?; }
        else { return Err("Extension contains an unsupported file type".into()); }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct ExtensionsList { supported: bool, items: Vec<ExtensionInfo>, edge_path: Option<String>, runtime_error: Option<String> }

#[tauri::command]
pub async fn extensions_list(app: tauri::AppHandle) -> Result<ExtensionsList, String> {
    let mut items = read_records(&app)?;
    let runtime_error = if cfg!(windows) {
        match crate::browser::runtime_list(app).await {
            Ok(active) => { for item in &mut items { item.runtime_enabled = active.iter().find(|(id, _)| id == &item.id).map(|(_, enabled)| *enabled); item.runtime_missing = item.runtime_enabled.is_none(); } None },
            Err(error) => Some(error),
        }
    } else { None };
    Ok(ExtensionsList { supported: cfg!(windows), items, edge_path: default_edge_path().map(|p| p.to_string_lossy().into_owned()), runtime_error })
}

#[tauri::command]
pub async fn extensions_import(app: tauri::AppHandle, path: String, source: Option<String>) -> Result<ExtensionInfo, String> {
    let _guard = MutationGuard::acquire()?;
    if !cfg!(windows) { return Err("Browser extensions are available on Windows".into()); }
    let inspected = manifest_info(Path::new(&path), String::new())?;
    let mut records = read_records(&app)?;
    let folder = tempfile::Builder::new().prefix("extension-").tempdir_in(storage(&app)?).map_err(|e| e.to_string())?;
    copy_folder(Path::new(&inspected.path), folder.path())?;
    let stable = folder.keep();
    let id = match crate::browser::runtime_install(app.clone(), stable.clone()).await {
        Ok(id) => id,
        Err(e) => { let _ = std::fs::remove_dir_all(&stable); return Err(e); }
    };
    let mut item = manifest_info(&stable, id.clone())?;
    item.source = source.unwrap_or_else(|| "folder".into());
    if let Some(existing) = records.iter().find(|r| r.id == id) {
        let restored = crate::browser::runtime_install(app.clone(), PathBuf::from(&existing.path)).await;
        if restored.is_ok() && !existing.enabled { let _ = crate::browser::runtime_set_enabled(app.clone(), id, false).await; }
        let _ = std::fs::remove_dir_all(&stable);
        return match restored { Ok(_) => Err("This extension is already installed".into()), Err(e) => Err(format!("The extension was already installed, and restoring it failed: {e}")) };
    }
    records.push(item.clone());
    if let Err(e) = write_records(&app, &records) {
        let _ = crate::browser::runtime_remove(app.clone(), id).await;
        let _ = std::fs::remove_dir_all(&stable);
        return Err(e);
    }
    Ok(item)
}

#[tauri::command]
pub async fn extensions_set_enabled(app: tauri::AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let _guard = MutationGuard::acquire()?;
    let mut records = read_records(&app)?;
    let item = records.iter_mut().find(|r| r.id == id).ok_or("Extension not found")?;
    crate::browser::runtime_set_enabled(app.clone(), id, enabled).await?;
    item.enabled = enabled;
    write_records(&app, &records)
}

#[tauri::command]
pub async fn extensions_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let _guard = MutationGuard::acquire()?;
    let mut records = read_records(&app)?;
    let index = records.iter().position(|r| r.id == id).ok_or("Extension not found")?;
    crate::browser::runtime_remove(app.clone(), id).await?;
    let item = records.remove(index);
    write_records(&app, &records)?;
    let root = storage(&app)?.canonicalize().map_err(|e| e.to_string())?;
    let path = PathBuf::from(item.path).canonicalize().map_err(|e| e.to_string())?;
    if path.parent() == Some(root.as_path()) { std::fs::remove_dir_all(path).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn extensions_inspect(path: String) -> Result<ExtensionInfo, String> {
    manifest_info(Path::new(&path), String::new())
}

#[tauri::command]
pub async fn extensions_choose_folder() -> Option<String> {
    rfd::AsyncFileDialog::new().set_title("Choose an extension folder").pick_folder().await.map(|f| f.path().to_string_lossy().into_owned())
}

pub fn default_edge_path() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Microsoft").join("Edge").join("User Data").join("Default").join("Extensions"))
}

fn version_parts(name: &str) -> Vec<u64> {
    name.split('_').next().unwrap_or("").split('.').map(|v| v.parse().unwrap_or(0)).collect()
}

#[tauri::command]
pub fn extensions_discover_edge(path: Option<String>) -> Result<Vec<ExtensionInfo>, String> {
    if !cfg!(windows) { return Err("Edge extension discovery is available on Windows".into()); }
    let root = path.map(PathBuf::from).or_else(default_edge_path).ok_or("Cannot locate the Edge profile")?;
    let entries = std::fs::read_dir(&root).map_err(|e| format!("Cannot read {}: {e}", root.display()))?;
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let id = entry.file_name().to_string_lossy().into_owned();
        if id.len() != 32 || !id.bytes().all(|c| (b'a'..=b'p').contains(&c)) { continue; }
        let Ok(versions) = std::fs::read_dir(entry.path()) else { continue };
        let mut versions: Vec<_> = versions.flatten().filter(|v| v.path().is_dir()).collect();
        versions.sort_by_key(|v| version_parts(&v.file_name().to_string_lossy()));
        if let Some(info) = versions.into_iter().rev().find_map(|v| manifest_info(&v.path(), id.clone()).ok()) { found.push(info); }
    }
    found.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(found)
}
