import test from 'node:test';
import assert from 'node:assert/strict';
import { safeMarkdownUrl, sanitizeMarkdownTree, assignHeadingIds, LOCAL_IMAGE_PREFIX } from '../src/markdown-safety.js';

test('Markdown URLs reject unsafe schemes and preserve web and file links', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,x', '//evil.test/x', 'java\nscript:alert(1)']) assert.equal(safeMarkdownUrl(value), false);
  for (const value of ['https://example.com', 'docs/file.md', '#section']) assert.equal(safeMarkdownUrl(value), true);
  assert.equal(safeMarkdownUrl('image.png', true), false);
  assert.equal(safeMarkdownUrl('https://example.com/image.png', true), true);
});
test('sanitization runs recursively before rendering', () => {
  const tree = { children: [{ type: 'blockquote', children: [{ type: 'html', value: '<img onerror=alert(1)>' }, { type: 'link', url: 'javascript:alert(1)', children: [{ type: 'text', value: 'bad' }] }, { type: 'image', url: 'local.png', alt: 'picture' }] }] };
  sanitizeMarkdownTree(tree);
  assert.deepEqual(tree.children[0].children, [{ type: 'text', value: '<img onerror=alert(1)>' }, { type: 'link', url: '', children: [{ type: 'text', value: 'bad' }] }, { type: 'image', url: LOCAL_IMAGE_PREFIX + 'local.png', alt: 'picture' }]);
});
test('heading ids are stable and distinguish duplicates', () => {
  const headings = [{ textContent: 'Hello, World!' }, { textContent: 'Hello, World!' }, { textContent: 'Nested heading' }];
  assignHeadingIds(headings);
  assert.deepEqual(headings.map(x => x.id), ['hello-world', 'hello-world-1', 'nested-heading']);
});

test('reference images resolve safely before rendering', () => {
  const tree = { children: [{ type: 'imageReference', identifier: 'logo', alt: 'Logo' }, { type: 'definition', identifier: 'logo', url: 'https://example.com/logo.png' }] };
  sanitizeMarkdownTree(tree);
  assert.equal(tree.children[0].url, 'https://example.com/logo.png');
});
