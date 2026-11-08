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
