import { localMarkdownImagePath, safeMarkdownUrl } from './markdown-safety.js';

// A leaf NodeView changes only its displayed image. ProseMirror retains the
// original src in the document, so Markdown serialization never contains blobs.
export function createMarkdownImageView(initialNode, {
  loadLocalImage,
  createImage = () => document.createElement('img'),
  createObjectURL = blob => URL.createObjectURL(blob),
  revokeObjectURL = url => URL.revokeObjectURL(url),
} = {}) {
  const dom = createImage();
  let node = initialNode, source, revision = 0, objectURL = null, destroyed = false;
  function releaseURL() {
    if (objectURL) revokeObjectURL(objectURL);
    objectURL = null;
  }
  function render() {
    dom.setAttribute('alt', node.attrs.alt || '');
    if (node.attrs.title) dom.setAttribute('title', node.attrs.title);
    else dom.removeAttribute('title');
    const nextSource = String(node.attrs.src || '');
    if (source === nextSource) return;
    source = nextSource;
    const request = ++revision;
    releaseURL();
    dom.removeAttribute('src');
    dom.removeAttribute('data-image-error');
    if (/^https?:\/\//i.test(source) && safeMarkdownUrl(source, true)) {
      dom.setAttribute('src', source);
      return;
    }
    const path = localMarkdownImagePath(source);
    if (!path || !loadLocalImage) return;
    Promise.resolve().then(() => loadLocalImage(path)).then(result => {
      if (destroyed || request !== revision) return;
      objectURL = createObjectURL(new Blob([new Uint8Array(result.data)], { type: result.mime }));
      dom.setAttribute('src', objectURL);
    }).catch(() => {
      if (!destroyed && request === revision) dom.setAttribute('data-image-error', 'true');
    });
  }
  render();
  return {
    dom,
    update(nextNode) {
      if (nextNode.type !== node.type) return false;
      node = nextNode;
      render();
      return true;
    },
    ignoreMutation: () => true,
    destroy() { destroyed = true; revision++; releaseURL(); },
  };
}
