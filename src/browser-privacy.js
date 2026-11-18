import { invoke, isTauri } from '@tauri-apps/api/core';

const names = ['Unknown', 'Microphone', 'Camera', 'Location', 'Notifications', 'Sensors', 'Clipboard read', 'Automatic downloads', 'File access', 'Autoplay', 'Local fonts', 'MIDI', 'Window management'];

// Mount into a trusted Cubicle settings section, never inside a remote browser view.
export function mountBrowserPrivacy(container) {
  container.innerHTML = `<h2>Browser privacy</h2><p>Manage saved site permissions and browsing data for Cubicle's shared browser profile on Windows. Open a browser pane first.</p>
    <div class="settings-card"><div class="setting-row"><span><strong>Saved site permissions</strong><small>Reset a permission to let the site ask again.</small></span><button type="button" data-refresh>Refresh</button></div><div data-permissions></div>
    <div class="setting-row"><span><strong>Site data</strong><small>Clears cookies and site storage; websites may sign you out.</small></span><button type="button" data-clear="site">Clear site data</button></div>
    <div class="setting-row"><span><strong>Cached files</strong><small>Clears the browser's disk cache.</small></span><button type="button" data-clear="cache">Clear cache</button></div><p data-status role="status" aria-live="polite"></p></div>`;
  const list = container.querySelector('[data-permissions]');
  const status = container.querySelector('[data-status]');
  const refresh = async () => {
    list.replaceChildren();
    if (!isTauri()) { status.textContent = 'Available in the Windows desktop app.'; return; }
    status.textContent = 'Loading site permissions…';
    try {
      const permissions = await invoke('browser_permissions_list');
      list.replaceChildren();
      for (const permission of permissions) {
        const row = document.createElement('div'); row.className = 'setting-row';
        const description = document.createElement('span');
        const title = document.createElement('strong'); title.textContent = permission.origin;
        const detail = document.createElement('small'); detail.textContent = `${names[permission.kind] || `Permission ${permission.kind}`} · ${permission.state === 1 ? 'Allowed' : permission.state === 2 ? 'Blocked' : 'Changed'}`;
        description.append(title, detail);
        const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Reset';
        reset.addEventListener('click', async () => {
          reset.disabled = true;
          try { await invoke('browser_permission_reset', { origin: permission.origin, kind: permission.kind }); await refresh(); }
          catch (error) { status.textContent = `Could not reset permission: ${error}`; reset.disabled = false; }
        });
        row.append(description, reset); list.append(row);
      }
      status.textContent = permissions.length ? '' : 'No saved site permissions.';
    } catch (error) { status.textContent = `Could not load site permissions: ${error}`; }
  };
  container.querySelector('[data-refresh]').addEventListener('click', refresh);
  container.querySelectorAll('[data-clear]').forEach(button => button.addEventListener('click', async () => {
    const site = button.dataset.clear === 'site';
    if (!window.confirm(site ? 'Clear cookies and site storage for all sites? You may be signed out.' : 'Clear cached browser files?')) return;
    button.disabled = true; status.textContent = 'Clearing browsing data…';
    try { await invoke('browser_data_clear', { category: button.dataset.clear }); status.textContent = 'Browsing data cleared.'; }
    catch (error) { status.textContent = `Could not clear browsing data: ${error}`; }
    finally { button.disabled = false; }
  }));
  return { refresh };
}
