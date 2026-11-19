export function readWorkspace(storage, key) {
  const saved = JSON.parse(storage.getItem(key) || 'null');
  if (saved === null) return null;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const optionalString = value => value == null || typeof value === 'string';
  const ids = new Set();
  if (!object(saved) || !Array.isArray(saved.spaces) || !optionalString(saved.activeSpaceId) || saved.spaces.some(item => {
    if (!object(item) || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim()) return true;
    ids.add(item.id);
    return !optionalString(item.path) || !optionalString(item.color)
      || (item.lastOpened != null && (typeof item.lastOpened !== 'number' || !Number.isFinite(item.lastOpened) || item.lastOpened < 0))
      || (item.layout != null && (!object(item.layout) || (item.layout.panels != null && !object(item.layout.panels))));
  })) throw new Error('Invalid saved workspace');
  return saved;
}
export function writeWorkspace(storage, key, state) {
  try { storage.setItem(key, JSON.stringify(state)); return true; }
  catch { return false; }
}
export function updateSpaceFileRoots(space, path, { panels, hasFiles, setFilesRoot }) {
  const livePanels = new Map(panels?.map(panel => [panel.id, panel]) || []);
  const ids = panels ? [...livePanels.keys()] : Object.keys(space.layout?.panels || {});
  for (const id of ids) {
    const panel = livePanels.get(id), saved = space.layout?.panels?.[id];
    const params = panel ? panel.api.getParameters() : saved?.params;
    if (params?.tool !== 'files') continue;
    // Mounted panes must confirm unsaved edits before changing their state.
    if (hasFiles(id)) { setFilesRoot(id, path); continue; }
    const updated = { ...params, filesRoot: path, filesPreview: undefined, openFile: undefined };
    if (panel) panel.api.updateParameters(updated);
    if (saved) saved.params = updated;
  }
}
export async function confirmQuitChanges({ dirtyFilePaneIds, isProfileDirty, saveFilePane, saveProfile, choose }) {
  const ids = dirtyFilePaneIds();
  const profileDirty = isProfileDirty();
  if (!ids.length && !profileDirty) return 'proceed';
  const choice = await choose(ids.length, profileDirty);
  if (choice === 'discard') return 'proceed';
  if (choice !== 'save') return 'cancel';
  if (isProfileDirty() && !saveProfile()) return 'profile-failed';
  for (const id of ids) if (!await saveFilePane(id)) return 'file-failed';
  return dirtyFilePaneIds().length || isProfileDirty() ? 'still-dirty' : 'proceed';
}
