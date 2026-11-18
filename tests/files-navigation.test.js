import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

class Element {
  constructor() {
    this.nodes = new Map();
    this.children = [];
    this.value = '';
    this.isConnected = true;
    this.clientWidth = 800;
    this.style = { setProperty() {} };
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  querySelectorAll() { return []; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  addEventListener() {}
  getBoundingClientRect() { return { width: 300 }; }
  remove() { this.isConnected = false; }
}

async function createFiles(choose, { slowPath = '/slow', filePins = [], entries = [], preview = () => '# Original', save = () => {}, editing = true } = {}) {
  const folderRequested = deferred(), folderLoaded = deferred();
  const calls = [], prompts = [], editors = [], states = [];
  const context = vm.createContext({
    console, URL, Blob, Uint8Array, setTimeout, clearTimeout,
    requestAnimationFrame() {},
    document: { createElement: () => new Element() },
  });
  const imports = {
    '@tauri-apps/api/core': {
      isTauri: () => true,
      invoke: async (name, args) => {
        calls.push([name, args]);
        if (name === 'list_files') {
          if (args.path === slowPath) { folderRequested.resolve(); return folderLoaded.promise; }
          return { path: args.path || '/root', entries };
        }
        if (name === 'preview_file') return preview(args.path);
        if (name === 'save_markdown') return save(args);
        if (name === 'resolve_file_link') return args.cwd + '/' + args.path;
        if (name === 'preview_image') return { data: [1, 2, 3], mime: 'image/png' };
      },
    },
    './files-search.js': { searchFileTree() {} },
    './text-preview.js': { createTextPreview() {} },
    './markdown-editor.js': {
      createMarkdownEditor: async (_parent, text, onChange, options) => {
        const editor = {
          text, onChange, options, readOnly: !!options?.readOnly, destroyed: false,
          markdown() { return this.text; },
          async destroy() { this.destroyed = true; },
        };
        editors.push(editor);
        return editor;
      },
    },
    './confirm-dialog.js': { chooseAction: async options => { prompts.push(options); return choose(); } },
    './markdown-safety.js': { assignHeadingIds() {}, LOCAL_IMAGE_PREFIX: 'local-image:' },
  };
  const module = new vm.SourceTextModule(await readFile(new URL('../src/files.js', import.meta.url), 'utf8'), { context });
  await module.link(name => new vm.SyntheticModule(Object.keys(imports[name]), function () {
    for (const [key, value] of Object.entries(imports[name])) this.setExport(key, value);
  }, { context }));
  await module.evaluate();
  const container = new Element();
  module.namespace.mountFiles('files', container, () => {}, '/root', [], { filePins, onStateChange: state => states.push(state) });
  const root = container.children[0];
  await root.openFilePath('/root/test.md');
  if (editing) await root.querySelector('.files-edit').onclick();
  const editor = editors.find(item => !item.readOnly);
  return {
    root, editor, editors, calls, prompts, states, folderRequested: folderRequested.promise, resolveFolder: folderLoaded.resolve,
    reload: () => root.querySelector('.files-preview-header').children.find(child => child.className === 'files-reload').onclick(),
    open: path => root.openFilePath(path),
    dirty: () => module.namespace.filePaneDirty('files'),
    edit(text) { editor.text = text; editor.onChange(text); },
    async loadFolder() {
      const result = root.setSpaceRoot('/slow');
      await folderRequested.promise;
      return { finish() { folderLoaded.resolve({ path: '/slow', entries: [] }); return result; } };
    },
    close: () => module.namespace.closeFiles('files'),
  };
}

test('cancelling a folder change preserves edits made while the folder was loading', async t => {
  const files = await createFiles(() => 'cancel');
  t.after(files.close);
  const folder = await files.loadFolder();
  files.edit('# New edits');
  assert.equal(await folder.finish(), false);
  assert.equal(files.prompts.length, 1);
  assert.equal(files.dirty(), true);
  assert.equal(files.editor.destroyed, false);
  assert.equal(files.root.querySelector('.files-preview-title').textContent, 'test.md');
  assert.equal(files.calls.filter(([name]) => name === 'save_markdown').length, 0);
});

test('saving during a delayed folder change writes the latest edits before leaving', async t => {
  const files = await createFiles(() => 'save');
  t.after(files.close);
  const folder = await files.loadFolder();
  files.edit('# New edits');
  assert.equal(await folder.finish(), true);
  const saves = files.calls.filter(([name]) => name === 'save_markdown');
  assert.equal(saves.length, 1);
  assert.equal(saves[0][1].content, '# New edits');
  assert.equal(files.dirty(), false);
  assert.equal(files.editor.destroyed, true);
});

test('discarding edits made during a delayed folder change permits navigation', async t => {
  const files = await createFiles(() => 'discard');
  t.after(files.close);
  const folder = await files.loadFolder();
  files.edit('# Discard these edits');
  assert.equal(await folder.finish(), true);
  assert.equal(files.prompts.length, 1);
  assert.equal(files.root.querySelector('.files-root-name').textContent, 'slow');
  assert.equal(files.calls.filter(([name]) => name === 'save_markdown').length, 0);
});

test('an approved discard is not prompted again unless the document changes', async t => {
  const files = await createFiles(() => 'discard');
  t.after(files.close);
  files.edit('# Already approved');
  const folder = await files.loadFolder();
  assert.equal(await folder.finish(), true);
  assert.equal(files.prompts.length, 1);
});

test('further edits require confirmation again after an earlier discard approval', async t => {
  const choices = ['discard', 'cancel'];
  const files = await createFiles(() => choices.shift());
  t.after(files.close);
  files.edit('# Already approved');
  const folder = await files.loadFolder();
  files.edit('# Keep these later edits');
  assert.equal(await folder.finish(), false);
  assert.equal(files.prompts.length, 2);
  assert.equal(files.editor.destroyed, false);
  assert.equal(files.dirty(), true);
});

test('revealing a pinned file also checks edits made while loading its parent folder', async t => {
  const files = await createFiles(() => 'cancel', {
    slowPath: '/root/nested',
    filePins: ['/root/nested/next.md'],
    entries: [{ name: 'nested', path: '/root/nested', directory: true }],
  });
  t.after(files.close);
  files.root.querySelector('.files-pinned-list').children[0].children[0].onclick();
  await files.folderRequested;
  files.edit('# Keep edits made during reveal');
  files.resolveFolder({
    path: '/root/nested',
    entries: [{ name: 'next.md', path: '/root/nested/next.md', directory: false }],
  });
  await new Promise(setImmediate);
  assert.equal(files.prompts.length, 1);
  assert.equal(files.dirty(), true);
  assert.equal(files.editor.destroyed, false);
  assert.equal(files.root.querySelector('.files-preview-title').textContent, 'test.md');
});

test('document reload reads external changes without navigating away', async t => {
  let text = '# Original';
  const files = await createFiles(() => 'cancel', { preview: () => text, editing: false });
  t.after(files.close);
  text = '# External changes';
  assert.equal(await files.reload(), true);
  assert.equal(files.calls.filter(([name]) => name === 'preview_file').length, 2);
  assert.equal(files.editors.at(-1).text, text);
  assert.equal(files.root.querySelector('.files-preview-title').textContent, 'test.md');
});

test('cancelling document reload retains unsaved edits and the current editor', async t => {
  const files = await createFiles(() => 'cancel');
  t.after(files.close);
  files.edit('# Keep my edits');
  assert.equal(await files.reload(), false);
  assert.equal(files.dirty(), true);
  assert.equal(files.editor.destroyed, false);
  assert.equal(files.calls.filter(([name]) => name === 'preview_file').length, 1);
});

test('saving before document reload completes the save before reading the file again', async t => {
  const files = await createFiles(() => 'save');
  t.after(files.close);
  files.edit('# Save my edits');
  assert.equal(await files.reload(), true);
  const fileCalls = files.calls.filter(([name]) => name === 'preview_file' || name === 'save_markdown');
  assert.deepEqual(fileCalls.map(([name]) => name), ['preview_file', 'save_markdown', 'preview_file']);
  assert.equal(fileCalls[1][1].content, '# Save my edits');
  assert.equal(files.editor.destroyed, true);
  assert.equal(files.dirty(), false);
});

test('a save conflict cancels document reload without destroying unsaved edits', async t => {
  const files = await createFiles(() => 'save', { save: () => { throw Error('File changed on disk'); } });
  t.after(files.close);
  files.edit('# Keep conflicting edits');
  assert.equal(await files.reload(), false);
  assert.equal(files.dirty(), true);
  assert.equal(files.editor.destroyed, false);
  assert.equal(files.calls.filter(([name]) => name === 'preview_file').length, 1);
  assert.match(files.root.querySelector('.files-preview-meta').textContent, /File changed on disk/);
});

test('discarding during document reload replaces edits with the current disk contents', async t => {
  let text = '# Original';
  const files = await createFiles(() => 'discard', { preview: () => text });
  t.after(files.close);
  files.edit('# Discard my edits');
  text = '# Current disk contents';
  assert.equal(await files.reload(), true);
  assert.equal(files.editor.destroyed, true);
  assert.equal(files.dirty(), false);
  assert.equal(files.editors.at(-1).text, text);
  assert.equal(files.calls.filter(([name]) => name === 'save_markdown').length, 0);
});

test('a failed preview can be retried by selecting the same path', async t => {
  let available = false;
  const files = await createFiles(() => 'cancel', { editing: false, preview: () => {
    if (!available) throw Error('File temporarily unavailable');
    return '# Available again';
  } });
  t.after(files.close);
  assert.match(files.root.querySelector('.files-document').textContent, /temporarily unavailable/);
  available = true;
  assert.equal(await files.open('/root/test.md'), true);
  assert.equal(files.calls.filter(([name]) => name === 'preview_file').length, 2);
  assert.equal(files.editors.at(-1).text, '# Available again');
});

test('missing pinned files can be removed without opening them', async t => {
  const files = await createFiles(() => 'cancel', { filePins: ['/root/missing.md'] });
  t.after(files.close);
  const row = files.root.querySelector('.files-pinned-list').children[0];
  const remove = row.children.find(child => child.className === 'files-pinned-remove');
  assert.ok(remove);
  const callsBefore = files.calls.length;
  remove.onclick();
  assert.equal(files.root.querySelector('.files-pinned-list').children.length, 0);
  assert.equal(files.states.at(-1).filePins.length, 0);
  assert.equal(files.calls.length, callsBefore);
});

test('read-only and editable Markdown both resolve images relative to the document', async t => {
  const files = await createFiles(() => 'cancel');
  t.after(files.close);
  const preview = files.editors.find(editor => editor.readOnly);
  for (const editor of [preview, files.editor]) {
    const result = await editor.options.loadLocalImage('images/my image.png');
    assert.equal(result.mime, 'image/png');
  }
  const paths = files.calls.filter(([name]) => name === 'resolve_file_link').map(([, args]) => `${args.cwd}/${args.path}`);
  assert.deepEqual(paths, ['/root/images/my image.png', '/root/images/my image.png']);
});
