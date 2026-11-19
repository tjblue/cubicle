import test from 'node:test';
import assert from 'node:assert/strict';
import { findFileLinks } from '../src/terminal-links.js';

function links(text) { return findFileLinks(text).map(link => link.value); }

test('recognizes spaced absolute Windows paths without including diagnostic text', () => {
  assert.deepEqual(links('at C:/Users/Jane Doe/project/main.js:12:3) from worker'), ['C:/Users/Jane Doe/project/main.js:12:3']);
  assert.deepEqual(links('C:\\Users\\Jane Doe\\my project\\main.test.js:12:3 failed'), ['C:\\Users\\Jane Doe\\my project\\main.test.js:12:3']);
  assert.deepEqual(links('Error in C:/my project/a.js:1 and C:/other project/b.ts:2'), ['C:/my project/a.js:1', 'C:/other project/b.ts:2']);
});

test('recognizes quoted paths and returns the source range inside the quotes', () => {
  for (const quote of ['"', "'", '`']) {
    const text = `open ${quote}C:\\Users\\Jane Doe\\file with spaces.md${quote} then continue`;
    const found = findFileLinks(text);
    assert.deepEqual(found, [{ value: 'C:\\Users\\Jane Doe\\file with spaces.md', index: 6 }]);
    assert.equal(text.slice(found[0].index, found[0].index + found[0].value.length), found[0].value);
  }
  assert.deepEqual(links('"C:/my project/README"'), ['C:/my project/README']);
  assert.deepEqual(links('"file with spaces.md"'), ['file with spaces.md']);
  assert.deepEqual(links('"C:/my project/a.js":12'), ['C:/my project/a.js']);
  assert.deepEqual(links('"C:/Jane\'s project/a.js"'), ["C:/Jane's project/a.js"]);
  assert.deepEqual(links('"/tmp/a file)"'), ['/tmp/a file)']);
});

test('keeps file URLs and local relative, Unix, UNC and extensionless paths', () => {
  assert.deepEqual(links('file:///C:/my%20project/a.js:12'), ['file:///C:/my%20project/a.js:12']);
  assert.deepEqual(links('src/my file.test.js:12:3'), ['src/my file.test.js:12:3']);
  assert.deepEqual(links('/home/Jane Doe/my project/a.py:2'), ['/home/Jane Doe/my project/a.py:2']);
  assert.deepEqual(links('\\\\server\\shared files\\a.md:2'), ['\\\\server\\shared files\\a.md:2']);
  assert.deepEqual(links('C:/Users/Jane Doe/README'), ['C:/Users/Jane Doe/README']);
  assert.deepEqual(links('/etc/hosts'), ['/etc/hosts']);
  assert.deepEqual(links('../README'), ['../README']);
});

test('does not turn URLs or quoted prose into file links', () => {
  assert.deepEqual(links('https://example.com/path/file.js:12 http://localhost:3000/src/app.js ftp://host/a.md'), []);
  assert.deepEqual(links('"https://example.com/path/a.js"'), []);
  assert.deepEqual(links('"not a file" and \'another sentence\''), []);
  assert.deepEqual(links('app.js:10:2, other.py:4)'), ['app.js:10:2', 'other.py:4']);
});
