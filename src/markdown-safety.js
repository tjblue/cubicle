// Applied to the parsed Markdown tree before Milkdown creates DOM nodes.
export function safeMarkdownUrl(value, image = false) {
  const url = String(value || '').trim();
  if (!url || /[\u0000-\u0020\u007f]/.test(url) || url.startsWith('//') || url.startsWith('\\\\')) return false;
  if (/^https?:\/\//i.test(url)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false;
  // Local image paths cannot be served directly by the desktop webview.
  return !image;
}
export const LOCAL_IMAGE_PREFIX = 'data:,cubicle-local-image-';
export function sanitizeMarkdownTree(tree) {
  const definitions = new Map();
  function collect(node) {
    if (node.type === 'definition') definitions.set(String(node.identifier).toLowerCase(), node);
    node.children?.forEach(collect);
  }
  collect(tree);
  function visit(node) {
    if (!node.children) return;
    node.children = node.children.map(child => {
      if (child.type === 'html') return { type: 'text', value: child.value || '' };
      if (child.type === 'imageReference') {
        const definition = definitions.get(String(child.identifier).toLowerCase());
        child = { type: 'image', url: definition?.url || '', title: definition?.title, alt: child.alt };
      }
      if ((child.type === 'link' || child.type === 'definition') && !safeMarkdownUrl(child.url)) child.url = '';
      if (child.type === 'image') {
        if (!safeMarkdownUrl(child.url)) return { type: 'text', value: child.alt || '' };
        if (!/^https?:\/\//i.test(child.url)) child.url = LOCAL_IMAGE_PREFIX + encodeURIComponent(child.url);
      }
      visit(child);
      return child;
    });
  }
  visit(tree);
}
export function assignHeadingIds(headings) {
  const used = new Map();
  for (const heading of headings) {
    const base = heading.textContent.toLowerCase().trim().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s+/g, '-');
    const count = used.get(base) || 0; used.set(base, count + 1);
    heading.id = count ? `${base}-${count}` : base;
  }
}
