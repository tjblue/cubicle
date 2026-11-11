import test from 'node:test';
import assert from 'node:assert/strict';
import { searchFileTree } from '../src/files-search.js';

test('searches nested, unopened folders and handles cycles and errors', async () => {
  const entries = {
    '/root': { path: '/root', entries: [{ name: 'src', path: '/root/src', directory: true }, { name: 'missing', path: '/missing', directory: true }] },
    '/root/src': { path: '/root/src', entries: [{ name: 'readme.md', path: '/root/src/readme.md', directory: false }, { name: 'loop', path: '/root', directory: true }] },
  };
  const found = await searchFileTree('/root', 'README', async path => { if (!entries[path]) throw Error('denied'); return entries[path]; });
  assert.deepEqual(found.results.map(item => item.path), ['/root/src/readme.md']);
  assert.equal(found.skipped, 1);
  assert.equal(found.truncated, false);
});

test('reports limits and cancellation instead of presenting incomplete results as complete', async () => {
  const listing = { path: '/root', entries: Array.from({ length: 3 }, (_, i) => ({ name: `file${i}`, path: `/root/file${i}`, directory: false })) };
  const limited = await searchFileTree('/root', 'file', async () => listing, () => true, 2);
  assert.equal(limited.truncated, true);
  assert.equal(limited.results.length, 2);
  const cancelled = await searchFileTree('/root', 'file', async () => listing, () => false);
  assert.equal(cancelled.cancelled, true);
});
