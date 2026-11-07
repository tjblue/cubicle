import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { java } from '@codemirror/lang-java';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { xml } from '@codemirror/lang-xml';
import { shell } from '@codemirror/legacy-modes/mode/shell';

function languageFor(name) {
  const lower = name.toLowerCase();
  const extension = lower.includes('.') ? lower.split('.').pop() : '';
  if (['js', 'mjs', 'cjs', 'jsx'].includes(extension)) return javascript({ jsx: extension === 'jsx' });
  if (['ts', 'tsx', 'mts', 'cts'].includes(extension)) return javascript({ typescript: true, jsx: extension === 'tsx' });
  if (['py', 'pyw'].includes(extension)) return python();
  if (['json', 'jsonc'].includes(extension)) return json();
  if (['html', 'htm'].includes(extension)) return html();
  if (['css', 'scss'].includes(extension)) return css();
  if (extension === 'rs') return rust();
  if (['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hxx'].includes(extension)) return cpp();
  if (extension === 'java') return java();
  if (extension === 'sql') return sql();
  if (['yml', 'yaml'].includes(extension)) return yaml();
  if (['xml', 'svg', 'xhtml'].includes(extension)) return xml();
  if (['sh', 'bash', 'zsh'].includes(extension) || ['.bashrc', '.zshrc', '.profile'].includes(lower)) return StreamLanguage.define(shell);
  return [];
}

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword], color: '#c6a4f5' },
  { tag: [tags.string, tags.special(tags.string)], color: '#a8d997' },
  { tag: [tags.number, tags.bool, tags.null], color: '#e5bc80' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#8293a8', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#90bef3' },
  { tag: [tags.typeName, tags.className, tags.tagName], color: '#e5bf84' },
  { tag: [tags.propertyName, tags.attributeName], color: '#a9c9ec' },
  { tag: [tags.operator, tags.punctuation], color: '#bdcde0' },
  { tag: tags.invalid, color: '#ff9a9a' },
]);

const previewTheme = EditorView.theme({
  '&': { height: '100%', color: '#d5deed', backgroundColor: '#171a24', fontSize: '12px' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'Cascadia Code, Consolas, monospace', lineHeight: '1.65' },
  '.cm-content': { padding: '16px 0', caretColor: 'transparent' },
  '.cm-line': { padding: '0 16px 0 8px', overflowWrap: 'anywhere' },
  '.cm-gutters': { backgroundColor: '#171a24', color: '#728198', borderRight: '1px solid #303a4b' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 12px', minWidth: '3em' },
  '&.cm-focused': { outline: 'none' },
}, { dark: true });

export function createTextPreview(parent, name, text) {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [lineNumbers(), EditorView.lineWrapping, EditorState.readOnly.of(true), EditorView.editable.of(false), syntaxHighlighting(highlight), previewTheme, languageFor(name)],
    }),
  });
}
