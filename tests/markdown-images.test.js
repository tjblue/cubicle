import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkdownImageView } from '../src/markdown-images.js';
import { LOCAL_IMAGE_PREFIX } from '../src/markdown-safety.js';

function createImage() {
  const attributes = new Map();
  return {
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key),
    getAttribute: key => attributes.get(key),
  };
}
const imageType = {};
const node = (src, extra = {}) => Object.freeze({ type: imageType, attrs: Object.freeze({ src, alt: 'Example', ...extra }) });
const tick = () => new Promise(setImmediate);

test('local image NodeViews display blobs without changing the Markdown destination', async () => {
  for (const src of ['images/my%20image.png', LOCAL_IMAGE_PREFIX + encodeURIComponent('images/my%20image.png')]) {
    const original = node(src), loaded = [], revoked = [];
    const view = createMarkdownImageView(original, {
      createImage,
      loadLocalImage: async path => { loaded.push(path); return { data: [1, 2], mime: 'image/png' }; },
      createObjectURL: () => 'blob:preview',
      revokeObjectURL: url => revoked.push(url),
    });
    await tick();
    assert.deepEqual(loaded, ['images/my image.png']);
    assert.equal(view.dom.getAttribute('src'), 'blob:preview');
    assert.equal(original.attrs.src, src);
    assert.equal(view.ignoreMutation(), true);
    view.destroy();
    assert.deepEqual(revoked, ['blob:preview']);
  }
});

test('image changes discard stale loads and release replaced display URLs', async () => {
  const pending = new Map(), revoked = [];
  const view = createMarkdownImageView(node('old.png'), {
    createImage,
    loadLocalImage: path => new Promise(resolve => pending.set(path, resolve)),
    createObjectURL: blob => `blob:${blob.size}`,
    revokeObjectURL: url => revoked.push(url),
  });
  await tick();
  assert.equal(view.update(node('new.png', { title: 'New image' })), true);
  await tick();
  pending.get('old.png')({ data: [1], mime: 'image/png' });
  await tick();
  assert.equal(view.dom.getAttribute('src'), undefined);
  pending.get('new.png')({ data: [1, 2], mime: 'image/png' });
  await tick();
  assert.equal(view.dom.getAttribute('src'), 'blob:2');
  assert.equal(view.update(node('https://example.com/image.png')), true);
  assert.equal(view.dom.getAttribute('src'), 'https://example.com/image.png');
  assert.deepEqual(revoked, ['blob:2']);
  view.destroy();
});

test('disposed images do not create blob URLs when pending native loads finish', async () => {
  let finish, created = 0;
  const view = createMarkdownImageView(node('image.png'), {
    createImage,
    loadLocalImage: () => new Promise(resolve => { finish = resolve; }),
    createObjectURL: () => { created++; return 'blob:unexpected'; },
  });
  await tick();
  view.destroy();
  finish({ data: [1], mime: 'image/png' });
  await tick();
  assert.equal(created, 0);
});

test('unsafe image URLs never reach native loading or the image src attribute', async () => {
  let loads = 0;
  for (const src of ['javascript:alert(1)', 'data:text/html,unsafe', '%2f%2fhost/image.png']) {
    const view = createMarkdownImageView(node(src), {
      createImage,
      loadLocalImage: async () => { loads++; },
    });
    await tick();
    assert.equal(view.dom.getAttribute('src'), undefined);
    view.destroy();
  }
  assert.equal(loads, 0);
});
