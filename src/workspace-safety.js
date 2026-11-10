export function readWorkspace(storage, key) {
  const saved = JSON.parse(storage.getItem(key) || 'null');
  if (saved !== null && (!Array.isArray(saved.spaces) || saved.spaces.some(item => !item || typeof item.id !== 'string' || typeof item.name !== 'string'))) throw new Error('Invalid saved workspace');
  return saved;
}
export function writeWorkspace(storage, key, state) {
  try { storage.setItem(key, JSON.stringify(state)); return true; }
  catch { return false; }
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
