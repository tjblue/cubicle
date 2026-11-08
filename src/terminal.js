import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { findFileLinks } from './terminal-links.js';
import { captureTerminalDirectory } from './terminal-directory-capture.js';
import '@xterm/xterm/css/xterm.css';

const sessions = new Map();

export function hasTerminal(id) { return sessions.has(id); }
export function getTerminalTitle(id) { return sessions.get(id)?.title || ''; }
export function mountTerminal(id, container, cwd = null, onTitleChange = () => {}, onFileLink = () => {}, options = {}) {
  let session = sessions.get(id);
  if (!session) {
    const element = document.createElement('div');
    element.className = 'terminal-surface';
    const terminal = new Terminal({
      linkHandler: { allowNonHttpProtocols: true, activate: (_event, uri) => { if (/^file:/i.test(uri)) session.onFileLink(uri, session.cwd); } },
      cursorBlink: true, fontFamily: 'Cascadia Code, Consolas, monospace', fontSize: 13,
      scrollback: 10000, allowProposedApi: false,
      theme: { background: '#171a24', foreground: '#dce4f2', cursor: '#c7d5f4', selectionBackground: '#718bb970' },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    session = { id: crypto.randomUUID(), element, terminal, fit, started: false, closed: false, ready: null, input: Promise.resolve(), cwd, onFileLink, onCwdChange: options.onCwdChange };
    const updateCwd = path => {
      if (session.closed || !path || session.cwd === path) return;
      session.cwd = path;
    };
    session.updateCwd = updateCwd;
    terminal.parser.registerOscHandler(7, value => { try { const url = new URL(value); if (url.protocol === 'file:') updateCwd(decodeURIComponent(url.pathname).replace(/^\/([a-z]:)/i, '$1')); } catch {} return false; });
    terminal.registerLinkProvider({ provideLinks(lineNumber, callback) {
      const line = terminal.buffer.active.getLine(lineNumber - 1); if (!line) { callback([]); return; }
      const text = line.translateToString(true); const links = [];
      for (const { value, index } of findFileLinks(text)) { const start = index + 1; links.push({ text: value, range: { start: { x: start, y: lineNumber }, end: { x: start + value.length - 1, y: lineNumber } }, activate: (_event, target) => session.onFileLink(target, session.cwd) }); }
      callback(links);
    }});
    sessions.set(id, session);
    container.append(element);
    terminal.open(element);
    session.title = '';
    session.onTitleChange = onTitleChange;
    terminal.onTitleChange((title) => {
      session.title = title.replace(/[\x00-\x1f\x7f]/g, '').trim();
      session.onTitleChange(session.title);
    });
    const channel = new Channel();
    channel.onmessage = (event) => {
      if (session.closed) return;
      if (event.type === 'output') terminal.write(new Uint8Array(event.data));
      if (event.type === 'exit') { session.started = false; terminal.writeln('\r\n\x1b[90m[Terminal session ended. Close this tab to start another.]\x1b[0m'); }
    };
    session.resize = () => {
      if (session.closed || !element.isConnected || !element.clientWidth || !element.clientHeight) return;
      try {
        fit.fit();
        if (session.started) invoke('terminal_resize', { id: session.id, cols: terminal.cols, rows: terminal.rows }).catch(() => {});
      } catch (error) { console.error('Terminal resize failed', error); }
    };
    session.observer = new ResizeObserver(() => {
      clearTimeout(session.resizeTimer);
      session.resizeTimer = setTimeout(() => session.resize(), 80);
    });
    session.observer.observe(element);
    const clipboardError = (error) => terminal.writeln(`\r\n\x1b[31mClipboard error: ${error}\x1b[0m`);
    const copySelection = () => {
      const text = terminal.getSelection();
      if (!text) return;
      const operation = isTauri() ? invoke('terminal_clipboard_write', { text }) : navigator.clipboard.writeText(text);
      operation.catch(clipboardError);
    };
    const pasteClipboard = () => {
      const operation = isTauri() ? invoke('terminal_clipboard_read') : navigator.clipboard.readText();
      operation.then((text) => { if (!session.closed) terminal.paste(text); }).catch(clipboardError);
    };
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const key = event.key.toLowerCase();
      const copy = event.ctrlKey && !event.altKey && key === 'c' && (event.shiftKey || terminal.hasSelection());
      const paste = (event.ctrlKey && !event.altKey && key === 'v') || (event.shiftKey && key === 'insert');
      if (copy || paste) {
        event.preventDefault();
        if (copy) copySelection(); else pasteClipboard();
        return false;
      }
      return true;
    });
    element.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (terminal.hasSelection()) copySelection(); else pasteClipboard();
    });
    terminal.onData((data) => {
      session.input = session.input.then(() => session.ready).then(() => {
        if (!session.closed && session.started) return invoke('terminal_write', { id: session.id, data });
      }).catch((error) => { if (!session.closed) terminal.writeln(`\r\n\x1b[31mInput error: ${error}\x1b[0m`); });
    });
    session.ready = new Promise((resolve) => requestAnimationFrame(resolve)).then(async () => {
      if (session.closed) return;
      session.resize();
      if (!isTauri()) throw new Error('Open the desktop app to use a terminal.');
      let startupCwd = cwd;
      if (options.savedCwd && startupCwd) {
        try { await invoke('validate_directory', { path: startupCwd }); }
        catch {
          terminal.writeln('\r\n\x1b[33m[The saved folder is unavailable; opening the default folder.]\x1b[0m');
          startupCwd = options.fallbackCwd || null;
          if (startupCwd) { try { await invoke('validate_directory', { path: startupCwd }); } catch { startupCwd = null; } }
          updateCwd(startupCwd || await invoke('terminal_default_cwd'));
        }
      }
      await invoke('terminal_start', { id: session.id, cols: terminal.cols, rows: terminal.rows, cwd: startupCwd, shell: options.shell || null, env: options.env || null, output: channel });
      if (!session.cwd) updateCwd(await invoke('terminal_default_cwd'));
      if (session.cwd) session.onCwdChange?.(session.cwd);
      if (options.command && !session.closed) await invoke('terminal_write', { id: session.id, data: options.command + '\r' });
      session.started = true;
      session.resize();
      terminal.focus();
    }).catch((error) => { if (!session.closed) terminal.writeln(`\r\n\x1b[31mCould not start terminal: ${error}\x1b[0m`); });
  } else {
    session.onTitleChange = onTitleChange;
    session.onFileLink = onFileLink;
    session.onCwdChange = options.onCwdChange;
    session.onTitleChange(session.title);
    container.append(session.element);
    requestAnimationFrame(() => session.resize());
  }
  return session;
}

// Capture all live shells before the app closes, including panes in inactive spaces.
export async function captureTerminalDirectories() {
  await Promise.all([...sessions.values()].map(session => captureTerminalDirectory(session, id => invoke('terminal_working_directory', { id }))));
}

export function refreshTerminal(id) {
  const session = sessions.get(id);
  if (session) requestAnimationFrame(() => session.resize());
}

export function closeTerminal(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  session.closed = true;
  session.observer.disconnect();
  clearTimeout(session.resizeTimer);
  session.terminal.dispose();
  // A close during startup waits for the spawn command to finish first.
  session.ready.finally(() => invoke('terminal_close', { id: session.id }).catch(() => {}));
}
