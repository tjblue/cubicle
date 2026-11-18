import { Folder, SquareTerminal, Globe, Search, ChevronLeft, ChevronRight, PanelLeft, Columns2, Rows2, Bell, Plus, ArrowLeft, ArrowRight, RotateCw, X, Star, Download, PanelsTopLeft, Ellipsis } from 'lucide';

const icons = { files: Folder, terminal: SquareTerminal, browser: Globe, search: Search,
  back: ChevronLeft, chevronRight: ChevronRight, sidebar: PanelLeft, splitRight: Columns2,
  splitDown: Rows2, bell: Bell, plus: Plus, arrowLeft: ArrowLeft, arrowRight: ArrowRight,
  reload: RotateCw, close: X, favorite: Star, downloads: Download, popup: PanelsTopLeft,
  more: Ellipsis };

// Lucide definitions are static, trusted SVG tag/attribute tuples imported above.
export function icon(name) {
  const definition = icons[name];
  if (!definition) throw new Error(`Unknown icon: ${name}`);
  const children = definition.map(([tag, attributes]) => `<${tag} ${Object.entries(attributes).map(([key, value]) => `${key}="${String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join(' ')}></${tag}>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${children}</svg>`;
}
