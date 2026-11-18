import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { getMarkdown, $remark } from '@milkdown/kit/utils';
import { sanitizeMarkdownTree } from './markdown-safety.js';
import { createMarkdownImageView } from './markdown-images.js';

const safePreview = $remark('safePreview', () => () => sanitizeMarkdownTree);

export async function createMarkdownEditor(parent, markdown, onChange, options = {}) {
  let ready = false;
  const editor = await Editor.make().config(ctx => {
    ctx.set(rootCtx, parent);
    ctx.set(defaultValueCtx, markdown);
    ctx.update(editorViewOptionsCtx, value => ({
      ...value,
      ...(options.readOnly ? { editable: () => false } : {}),
      nodeViews: {
        ...value.nodeViews,
        image: node => createMarkdownImageView(node, { loadLocalImage: options.loadLocalImage }),
      },
    }));
    ctx.get(listenerCtx).markdownUpdated((_ctx, value) => { if (ready) onChange(value); });
  }).use(commonmark).use(gfm).use(listener).use(options.readOnly ? safePreview : []).create();
  ready = true;
  return { markdown: () => editor.action(getMarkdown()), destroy: () => editor.destroy() };
}
