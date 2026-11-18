use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::future::Future;
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

#[derive(Clone, Debug, Serialize, Deserialize)]
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

fn remove_managed_folder(root: &Path, path: &Path) -> Result<(), String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = match path.canonicalize() {
        Ok(path) => path,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    if path.parent() != Some(root.as_path()) || !path.is_dir() {
        return Err("Extension cleanup path is outside the managed extension folders".into());
    }
    std::fs::remove_dir_all(path).map_err(|e| e.to_string())
}

trait ExtensionRuntime: Sync {
    fn install(&self, path: PathBuf) -> impl Future<Output = Result<String, String>> + Send;
    fn set_enabled(&self, id: String, enabled: bool) -> impl Future<Output = Result<(), String>> + Send;
    fn remove(&self, id: String) -> impl Future<Output = Result<(), String>> + Send;
}

struct BrowserExtensionRuntime(tauri::AppHandle);
impl ExtensionRuntime for BrowserExtensionRuntime {
    fn install(&self, path: PathBuf) -> impl Future<Output = Result<String, String>> + Send {
        crate::browser::runtime_install(self.0.clone(), path)
    }
    fn set_enabled(&self, id: String, enabled: bool) -> impl Future<Output = Result<(), String>> + Send {
        crate::browser::runtime_set_enabled(self.0.clone(), id, enabled)
    }
    fn remove(&self, id: String) -> impl Future<Output = Result<(), String>> + Send {
        crate::browser::runtime_remove(self.0.clone(), id)
    }
}

async fn commit_import(
    runtime: &impl ExtensionRuntime,
    root: &Path,
    mut records: Vec<ExtensionInfo>,
    mut item: ExtensionInfo,
    active: &[(String, bool)],
    persist: impl FnOnce(&[ExtensionInfo]) -> Result<(), String>,
) -> Result<ExtensionInfo, String> {
    let staged = PathBuf::from(&item.path);
    let id = match runtime.install(staged.clone()).await {
        Ok(id) => id,
        Err(error) => {
            // A timeout only stops waiting; WebView2 can still finish installing
            // from this directory after the command has returned.
            if error.contains("WebView2 did not complete the extension operation") {
                return Err(format!("{error} The browser may still finish the import. Files were retained at {}. Refresh extension status before retrying.", staged.display()));
            }
            let _ = remove_managed_folder(root, &staged);
            return Err(error);
        }
    };
    let previous = records.iter().find(|record| record.id == id).cloned();
    item.id = id.clone();
    if let Some(previous) = &previous {
        item.enabled = active.iter().find(|(active_id, _)| active_id == &id)
            .map(|(_, enabled)| *enabled).unwrap_or(previous.enabled);
    }
    let configured = if previous.is_some() {
        runtime.set_enabled(id.clone(), item.enabled).await
    } else { Ok(()) };
    let saved = configured.and_then(|_| {
        if let Some(index) = records.iter().position(|record| record.id == id) {
            records[index] = item.clone();
        } else {
            records.push(item.clone());
        }
        persist(&records)
    });
    if let Err(error) = saved {
        let restored = if let Some(previous) = &previous {
            match runtime.install(PathBuf::from(&previous.path)).await {
                Ok(restored_id) if restored_id == id => runtime.set_enabled(id.clone(), item.enabled).await,
                Ok(_) => Err("Restored extension returned a different ID".into()),
                Err(error) => Err(error),
            }
        } else {
            runtime.remove(id).await
        };
        if let Err(rollback_error) = restored {
            // The runtime may still refer to the imported folder. Keep its files
            // and the old record so neither installation loses its recovery path.
            return Err(format!("{error}. Could not restore the previous browser state: {rollback_error}. Imported files were retained at {}.", staged.display()));
        }
        let _ = remove_managed_folder(root, &staged);
        return Err(error);
    }
    if let Some(previous) = previous {
        if previous.path != item.path {
            let _ = remove_managed_folder(root, Path::new(&previous.path));
        }
    }
    Ok(item)
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
    let records = read_records(&app)?;
    let active = crate::browser::runtime_list(app.clone()).await?;
    let root = storage(&app)?;
    let folder = tempfile::Builder::new().prefix("extension-").tempdir_in(&root).map_err(|e| e.to_string())?;
    copy_folder(Path::new(&inspected.path), folder.path())?;
    let mut item = manifest_info(folder.path(), String::new())?;
    item.source = source.unwrap_or_else(|| "folder".into());
    let stable = folder.keep();
    item.path = stable.to_string_lossy().into_owned();
    commit_import(&BrowserExtensionRuntime(app.clone()), &root, records, item, &active, |records| write_records(&app, records)).await
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
    remove_managed_folder(&storage(&app)?, Path::new(&item.path))
}

#[tauri::command]
pub fn extensions_inspect(path: String) -> Result<ExtensionInfo, String> {
    manifest_info(Path::new(&path), String::new())
}

#[tauri::command]
pub async fn extensions_choose_folder(title: Option<String>) -> Option<String> {
    rfd::AsyncFileDialog::new().set_title(title.as_deref().unwrap_or("Choose an extension folder")).pick_folder().await.map(|f| f.path().to_string_lossy().into_owned())
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
    discover_edge(&root)
}

fn discover_edge(root: &Path) -> Result<Vec<ExtensionInfo>, String> {
    let extensions = root.join("Extensions");
    let root = if extensions.is_dir() { extensions.as_path() } else { root };
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::task::{Context, Poll, Wake, Waker};

    fn ready<F: Future>(future: F) -> F::Output {
        struct Noop;
        impl Wake for Noop { fn wake(self: Arc<Self>) {} }
        let waker = Waker::from(Arc::new(Noop));
        let mut context = Context::from_waker(&waker);
        match Box::pin(future).as_mut().poll(&mut context) {
            Poll::Ready(result) => result,
            Poll::Pending => panic!("Fake runtime operations must complete immediately"),
        }
    }

    #[derive(Default)]
    struct RuntimeState {
        path: Option<PathBuf>,
        enabled: bool,
        removed: bool,
        fail_enable_once: bool,
        fail_install: Option<PathBuf>,
        install_error: Option<String>,
    }
    #[derive(Default)]
    struct FakeRuntime(Mutex<RuntimeState>);
    impl ExtensionRuntime for FakeRuntime {
        fn install(&self, path: PathBuf) -> impl Future<Output = Result<String, String>> + Send {
            async move {
                let mut state = self.0.lock().unwrap();
                if state.fail_install.as_ref() == Some(&path) { return Err(state.install_error.clone().unwrap_or_else(|| "Cannot install".into())); }
                state.path = Some(path);
                state.enabled = true;
                Ok("example-id".into())
            }
        }
        fn set_enabled(&self, _: String, enabled: bool) -> impl Future<Output = Result<(), String>> + Send {
            async move {
                let mut state = self.0.lock().unwrap();
                if state.fail_enable_once { state.fail_enable_once = false; return Err("Cannot enable".into()); }
                state.enabled = enabled;
                Ok(())
            }
        }
        fn remove(&self, _: String) -> impl Future<Output = Result<(), String>> + Send {
            async move {
                let mut state = self.0.lock().unwrap();
                state.removed = true;
                state.path = None;
                Ok(())
            }
        }
    }

    fn item(path: &Path, version: &str) -> ExtensionInfo {
        ExtensionInfo {
            id: "example-id".into(), name: "Example".into(), version: version.into(),
            description: String::new(), path: path.to_string_lossy().into_owned(),
            permissions: Vec::new(), enabled: true, source: "folder".into(),
            runtime_enabled: None, runtime_missing: false,
        }
    }

    fn folders() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let old = root.path().join("old");
        let staged = root.path().join("staged");
        std::fs::create_dir(&old).unwrap();
        std::fs::create_dir(&staged).unwrap();
        (root, old, staged)
    }

    #[test]
    fn update_replaces_record_and_preserves_actual_disabled_state() {
        let (root, old, staged) = folders();
        let runtime = FakeRuntime::default();
        let mut saved = Vec::new();
        let result = ready(commit_import(&runtime, root.path(), vec![item(&old, "1")], item(&staged, "2"),
            &[("example-id".into(), false)], |records| { saved = records.to_vec(); Ok(()) })).unwrap();
        assert_eq!(result.version, "2");
        assert!(!result.enabled);
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].path, staged.to_string_lossy().as_ref());
        assert!(!saved[0].enabled);
        let state = runtime.0.lock().unwrap();
        assert_eq!(state.path.as_ref(), Some(&staged));
        assert!(!state.enabled);
        assert!(!old.exists());
        assert!(staged.exists());
    }

    #[test]
    fn failed_record_save_restores_old_runtime_and_keeps_old_files() {
        let (root, old, staged) = folders();
        let runtime = FakeRuntime::default();
        let result = ready(commit_import(&runtime, root.path(), vec![item(&old, "1")], item(&staged, "2"),
            &[("example-id".into(), false)], |_| Err("Disk full".into())));
        assert_eq!(result.unwrap_err(), "Disk full");
        let state = runtime.0.lock().unwrap();
        assert_eq!(state.path.as_ref(), Some(&old));
        assert!(!state.enabled);
        assert!(old.exists());
        assert!(!staged.exists());
    }

    #[test]
    fn failed_enable_rolls_back_before_persisting_records() {
        let (root, old, staged) = folders();
        let runtime = FakeRuntime::default();
        runtime.0.lock().unwrap().fail_enable_once = true;
        let result = ready(commit_import(&runtime, root.path(), vec![item(&old, "1")], item(&staged, "2"),
            &[("example-id".into(), false)], |_| panic!("Must not save after configuration failed")));
        assert_eq!(result.unwrap_err(), "Cannot enable");
        let state = runtime.0.lock().unwrap();
        assert_eq!(state.path.as_ref(), Some(&old));
        assert!(!state.enabled);
        assert!(old.exists());
        assert!(!staged.exists());
    }

    #[test]
    fn failed_new_install_save_removes_runtime_before_deleting_its_files() {
        let (root, _, staged) = folders();
        let runtime = FakeRuntime::default();
        let result = ready(commit_import(&runtime, root.path(), Vec::new(), item(&staged, "2"),
            &[], |_| Err("Disk full".into())));
        assert_eq!(result.unwrap_err(), "Disk full");
        assert!(runtime.0.lock().unwrap().removed);
        assert!(!staged.exists());
    }

    #[test]
    fn failed_rollback_retains_both_folders_and_reports_recovery_path() {
        let (root, old, staged) = folders();
        let runtime = FakeRuntime::default();
        runtime.0.lock().unwrap().fail_install = Some(old.clone());
        let error = ready(commit_import(&runtime, root.path(), vec![item(&old, "1")], item(&staged, "2"),
            &[], |_| Err("Disk full".into()))).unwrap_err();
        assert!(error.contains("Could not restore"));
        assert!(error.contains(staged.to_string_lossy().as_ref()));
        assert!(old.exists());
        assert!(staged.exists());
    }

    #[test]
    fn install_timeout_retains_files_for_a_late_browser_completion() {
        let (root, old, staged) = folders();
        let runtime = FakeRuntime::default();
        {
            let mut state = runtime.0.lock().unwrap();
            state.fail_install = Some(staged.clone());
            state.install_error = Some("WebView2 did not complete the extension operation.".into());
        }
        let error = ready(commit_import(&runtime, root.path(), vec![item(&old, "1")], item(&staged, "2"),
            &[], |_| panic!("Must not save an import with an unknown outcome"))).unwrap_err();
        assert!(error.contains("browser may still finish"));
        assert!(error.contains(staged.to_string_lossy().as_ref()));
        assert!(old.exists());
        assert!(staged.exists());
        assert!(!runtime.0.lock().unwrap().removed);
    }

    #[test]
    fn cleanup_rejects_the_root_and_unmanaged_paths() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("keep"), "unchanged").unwrap();
        assert!(remove_managed_folder(root.path(), root.path()).is_err());
        assert!(remove_managed_folder(root.path(), outside.path()).is_err());
        assert!(outside.path().join("keep").exists());
    }

    #[test]
    fn discovery_accepts_both_profile_and_extensions_folders() {
        let root = tempfile::tempdir().unwrap();
        let extensions = root.path().join("Extensions");
        let id = "a".repeat(32);
        for version in ["1.0_0", "2.0_0"] {
            let path = extensions.join(&id).join(version);
            std::fs::create_dir_all(&path).unwrap();
            std::fs::write(path.join("manifest.json"), serde_json::json!({
                "manifest_version": 3, "name": "Example", "version": version.split('_').next().unwrap()
            }).to_string()).unwrap();
        }
        for path in [root.path(), extensions.as_path()] {
            let found = discover_edge(path).unwrap();
            assert_eq!(found.len(), 1);
            assert_eq!(found[0].id, id);
            assert_eq!(found[0].version, "2.0");
        }
    }
}
