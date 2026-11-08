// Return a pane only when all evidence identifies exactly one current terminal.
export function normalizeSessionPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let p = value.trim().replaceAll('/', '\\');
  if (p.startsWith('\\\\?\\UNC\\')) p = '\\\\' + p.slice(8);
  else if (p.startsWith('\\\\?\\')) p = p.slice(4);
  p = p.replace(/\\+$/, '');
  return p.toLowerCase();
}
export function matchSessionEvent(event, candidates, windowMs = 15000) {
  const provider = String(event?.provider || '').toLowerCase();
  const cwd = normalizeSessionPath(event?.event?.cwd);
  const when = Date.parse(event?.receivedAt);
  const sessionId = event?.event?.session_id;
  const source = event?.event?.source;
  if (!['codex', 'claude', 'gemini'].includes(provider) || !cwd || !Number.isFinite(when) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId || '') || ['compact', 'clear'].includes(source)) return { status: 'invalid' };
  if (event.terminalId) {
    const candidate = candidates.find(c => c.terminalId === event.terminalId);
    return candidate ? { status: 'matched', candidate, binding: { provider, sessionId, cwd: event.event.cwd } } : { status: 'unmatched' };
  }
  const matches = candidates.filter(c => normalizeSessionPath(c.cwd) === cwd && c.providers?.includes(provider) && c.enters.some(t => when - t >= -1000 && when - t <= windowMs));
  if (matches.length > 1) return { status: 'ambiguous', matches };
  if (!matches.length) return { status: 'unmatched' };
  return { status: 'matched', candidate: matches[0], binding: { provider, sessionId, cwd: event.event.cwd } };
}
