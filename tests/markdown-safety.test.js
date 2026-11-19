import test from 'node:test';
import assert from 'node:assert/strict';
import { safeMarkdownUrl, sanitizeMarkdownTree, assignHeadingIds, LOCAL_IMAGE_PREFIX, localMarkdownImagePath } from '../src/markdown-safety.js';

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

test('local image paths decode filenames after separating query and fragment', () => {
  const source = 'images/my%20image%23part%3F.png?size=2#preview';
  const tree = { children: [{ type: 'image', url: source, alt: 'Example' }] };
  sanitizeMarkdownTree(tree);
  assert.equal(localMarkdownImagePath(tree.children[0].url), 'images/my image#part?.png');
  assert.equal(localMarkdownImagePath(source), 'images/my image#part?.png');
  assert.equal(localMarkdownImagePath('images/my image.png'), 'images/my image.png');
  assert.equal(localMarkdownImagePath('images/100%25.png'), 'images/100%.png');
});

test('local image decoding rejects unsafe schemes, malformed escapes, and control characters', () => {
  for (const source of [
    'javascript:alert(1)', '%6aavascript%3aalert(1)', 'data:image/png,abc',
    '//host/image.png', '%2f%2fhost/image.png', '%5c%5chost/image.png',
    'image%00.png', 'image%0a.png', 'image%GG.png', 'https://example.com/image.png',
    LOCAL_IMAGE_PREFIX + '%GG',
  ]) assert.equal(localMarkdownImagePath(source), null, source);
});

test('heading IDs stay unique when suffixes collide with existing heading names', () => {
  const headings = ['Foo', 'Foo-1', 'Foo', 'Foo-2', 'Foo'].map(textContent => ({ textContent }));
  assignHeadingIds(headings);
  assert.deepEqual(headings.map(heading => heading.id), ['foo', 'foo-1', 'foo-2', 'foo-2-1', 'foo-3']);
  assert.equal(new Set(headings.map(heading => heading.id)).size, headings.length);
});
