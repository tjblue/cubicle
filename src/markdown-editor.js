import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { getMarkdown } from '@milkdown/kit/utils';

export async function createMarkdownEditor(parent, markdown, onChange) {
  let ready = false;
  const editor = await Editor.make().config(ctx => {
    ctx.set(rootCtx, parent);
    ctx.set(defaultValueCtx, markdown);
    ctx.get(listenerCtx).markdownUpdated((_ctx, value) => { if (ready) onChange(value); });
  }).use(commonmark).use(gfm).use(listener).create();
  ready = true;
  return { markdown: () => editor.action(getMarkdown()), destroy: () => editor.destroy() };
}
