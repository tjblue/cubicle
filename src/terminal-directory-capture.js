// OSC 7 uses a file URL; Windows share hosts form part of the filesystem path.
export function terminalDirectoryFromOsc(value, windows = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'file:') return null;
    const path = decodeURIComponent(url.pathname);
    if (/^\/[a-z]:/i.test(path)) return path.slice(1);
    if (windows && url.hostname && url.hostname !== 'localhost') return `\\\\${url.hostname}${path.replaceAll('/', '\\')}`;
    return path || null;
  } catch { return null; }
}

export function terminalDirectoryFromNotification(value) {
  if (!value.startsWith('9;')) return null;
  let path = value.slice(2);
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
  return /^(?:[a-z]:[\\/]|\\\\[^\\])/i.test(path) ? path : null;
}

// A terminal may have exited or been closed while its directory is being read.
export async function captureTerminalDirectory(session, readDirectory) {
  await session.ready;
  if (session.closed) return;
  if (session.started) {
    try { session.updateCwd(await readDirectory(session.id)); }
    catch (error) { console.warn('Could not check terminal folder:', error); }
  }
  if (!session.closed && session.cwd) session.onCwdChange?.(session.cwd);
}
