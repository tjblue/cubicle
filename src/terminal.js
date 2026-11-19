import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { findFileLinks } from './terminal-links.js';
import { captureTerminalDirectory, terminalDirectoryFromOsc, terminalDirectoryFromNotification } from './terminal-directory-capture.js';
import { listenForTerminalAttention } from './terminal-attention.js';
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
    session = { id: crypto.randomUUID(), element, terminal, fit, started: false, starting: false, closed: false, ready: null, input: Promise.resolve(), cwd, onFileLink, onCwdChange: options.onCwdChange, onInput: options.onInput };
    const updateCwd = path => {
      if (session.closed || !path || session.cwd === path) return;
      session.cwd = path;
      session.onCwdChange?.(path);
    };
    session.updateCwd = updateCwd;
    terminal.parser.registerOscHandler(7, value => { updateCwd(terminalDirectoryFromOsc(value, /^Win/i.test(navigator.platform || ''))); return false; });
    terminal.parser.registerOscHandler(9, value => {
      const path = terminalDirectoryFromNotification(value);
      if (!path) return false;
      updateCwd(path);
      return true;
    });
    session.disposeAttention = listenForTerminalAttention(terminal, kind => session.onAttention?.(kind));
    session.onAttention = options.onAttention;
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
    const restart = document.createElement('button'); restart.type = 'button'; restart.className = 'terminal-restart'; restart.textContent = 'Restart terminal'; restart.hidden = true;
    element.append(restart);
    restart.addEventListener('click', () => { if (session.closed || session.closingForReload || session.started || session.starting) return; session.id = crypto.randomUUID(); session.ready = start(false); });
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
      if (session.closingForReload) return;
      session.onInput?.();
      session.input = session.input.then(() => session.ready).then(() => {
        if (!session.closed && session.started) return invoke('terminal_write', { id: session.id, data });
      }).catch((error) => { if (!session.closed) terminal.writeln(`\r\n\x1b[31mInput error: ${error}\x1b[0m`); });
    });
    const start = (runCommand) => {
      const runtimeId = session.id; let exited = false; let failed = false;
      session.starting = true; restart.hidden = true;
      return new Promise((resolve) => requestAnimationFrame(resolve)).then(async () => {
      const channel = new Channel();
      channel.onmessage = event => {
        if (session.closed || failed || session.id !== runtimeId) return;
        if (event.type === 'output') terminal.write(new Uint8Array(event.data));
        if (event.type === 'exit') { exited = true; session.started = false; if (!session.starting) restart.hidden = false; terminal.writeln('\r\n\x1b[90m[Terminal session ended.]\x1b[0m'); }
      };
      if (session.closed) return;
      session.resize();
      if (!isTauri()) throw new Error('Open the desktop app to use a terminal.');
      let startupCwd = session.cwd;
      if ((options.savedCwd || !runCommand) && startupCwd) {
        try { await invoke('validate_directory', { path: startupCwd }); }
        catch {
          terminal.writeln('\r\n\x1b[33m[The saved folder is unavailable; opening the default folder.]\x1b[0m');
          startupCwd = options.fallbackCwd || null;
          if (startupCwd) { try { await invoke('validate_directory', { path: startupCwd }); } catch { startupCwd = null; } }
          updateCwd(startupCwd || await invoke('terminal_default_cwd'));
        }
      }
      await invoke('terminal_start', { id: runtimeId, cols: terminal.cols, rows: terminal.rows, cwd: startupCwd, shell: options.shell || null, env: options.env || null, output: channel });
      if (!session.cwd) updateCwd(await invoke('terminal_default_cwd'));
      if (session.cwd) session.onCwdChange?.(session.cwd);
      if (exited || session.closed) return;
      session.started = true;
      if (runCommand && options.command) await invoke('terminal_write', { id: runtimeId, data: options.command + '\r' });
      session.resize();
      terminal.focus();
      }).catch(async (error) => {
        failed = true; session.started = false;
        // Startup may fail after the backend created a process (for example, when
        // sending the profile command). Always release this particular runtime.
        await invoke('terminal_close', { id: runtimeId }).catch(() => {});
        if (!session.closed) terminal.writeln(`\r\n\x1b[31mCould not start terminal: ${error}\x1b[0m`);
      }).finally(() => {
        session.starting = false;
        if (!session.closed && (failed || exited)) restart.hidden = false;
      });
    };
    session.ready = start(true);
  } else {
    session.onTitleChange = onTitleChange;
    session.onFileLink = onFileLink;
    session.onCwdChange = options.onCwdChange;
    session.onInput = options.onInput;
    session.onAttention = options.onAttention;
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

function detachTerminal(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  session.closed = true;
  session.observer.disconnect();
  session.disposeAttention();
  clearTimeout(session.resizeTimer);
  session.terminal.dispose();
  return session;
}

export function closeTerminal(id) {
  const session = detachTerminal(id);
  if (!session) return Promise.resolve();
  // A close during startup waits for the spawn command to finish first.
  const runtimeId = session.id;
  return session.ready.finally(() => invoke('terminal_close', { id: runtimeId })).catch(error => console.warn('Could not close terminal:', error));
}

export async function closeTerminalsForReload() {
  const pending = [...sessions.entries()];
  for (const [, session] of pending) session.closingForReload = true;
  try {
    await Promise.all(pending.map(([, session]) => session.ready));
    // Include sessions left behind by an earlier interface reload.
    await invoke('terminal_close_all');
    for (const [id, session] of pending) if (sessions.get(id) === session) detachTerminal(id);
  } finally {
    // A failed native cleanup keeps the remaining terminals usable for retry.
    for (const [, session] of pending) session.closingForReload = false;
  }
}
